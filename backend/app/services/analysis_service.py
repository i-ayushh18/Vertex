import hashlib
import time
import logging
from typing import Dict, Any, Optional, List, Tuple

from ..parser import PythonParser
from ..config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


class AnalysisService:
    """
    Service for code analysis with robust caching and proper incremental parsing
    using PythonParser.get_tree() and PythonParser.analyze_tree().
    """

    def __init__(self):
        self.parser = PythonParser()
        # Cache by content hash
        self._cache: Dict[str, Dict[str, Any]] = {}
        self._cache_ts: Dict[str, float] = {}
        # Per-file state for incremental parsing
        # file_states[file_path] = {"content": str, "tree": Tree, "last_modified": float}
        self.file_states: Dict[str, Dict[str, Any]] = {}

    def analyze(    
        self,
        code: str,
        file_path: Optional[str] = None,
        force: bool = False
    ) -> Dict[str, Any]:
        # 1) Guards
        if not code or not code.strip():
            logger.debug("[Analysis] Empty code; returning empty result")
            return self._empty_result()
        if len(code) > settings.MAX_FILE_SIZE:
            raise ValueError(f"File too large (max {settings.MAX_FILE_SIZE} bytes)")

        # 2) Cache
        key = self._hash(code)
        if not force:
            cached = self._get_cache(key)
            if cached is not None:
                # Don’t get stuck on stale-empties
                if cached["metadata"]["function_count"] > 0 or cached["metadata"]["call_count"] > 0:
                    logger.debug("[Analysis] Returning cached non-empty result")
                    return cached
                logger.debug("[Analysis] Cached result empty; forcing fresh parse")

        # 3) Parse tree (incremental if possible), then analyze
        tree = None
        if file_path:
            state = self.file_states.get(file_path)
            if state:
                old_code = state.get("content", "")
                old_tree = state.get("tree")
                if old_tree is not None and old_code != code:
                    # Compute a single full-buffer replacement edit (simple but correct)
                    edit = self._compute_full_edit(old_code, code)
                    try:
                        # Apply edit to old tree
                        old_tree.edit(**edit)
                    except Exception as e:
                        logger.warning("[Analysis] tree.edit failed; will full-parse. %s", e, exc_info=True)
                        old_tree = None

                    # Incremental reparse using underlying tree-sitter parser
                    try:
                        new_code_bytes = code.encode("utf8")
                        tree = self.parser.parser.parse(new_code_bytes, old_tree) if old_tree else self.parser.parser.parse(new_code_bytes)
                    except Exception as e:
                        logger.warning("[Analysis] incremental parse failed; falling back to full parse. %s", e, exc_info=True)
                        tree = self.parser.get_tree(code)
                else:
                    # Same content -> reuse old tree if present, else full-parse
                    tree = old_tree or self.parser.get_tree(code)
            else:
                # First time seeing file
                tree = self.parser.get_tree(code)
        else:
            # No file id -> full parse (no incremental)
            tree = self.parser.get_tree(code)

        if tree is None:
            logger.debug("[Analysis] No tree produced; returning empty result")
            result = self._empty_result()
        else:
            result = self.parser.analyze_tree(tree, code)
            result = self._normalize(result)

        # 4) Update per-file state
        if file_path:
            self.file_states[file_path] = {
                "content": code,
                "tree": tree,
                "last_modified": time.time()
            }

        # 5) Cache only non-empty results
        if result["metadata"]["function_count"] > 0 or result["metadata"]["call_count"] > 0:
            self._put_cache(key, result)
        else:
            logger.debug("[Analysis] Non-fatal: analysis empty; not caching.")

        return result
    
    def analyze_project(
        self,
        files: Dict[str, str],
        project_context: Dict[str, Any],
        target_file: str
    ) -> Dict[str, Any]:
        """
        Analyze a target file with full project context.
        
        Args:
            files: Dict mapping file paths to their content
            project_context: Project-level context with import map and symbol table
            target_file: The file to analyze
            
        Returns:
            Analysis result with cross-file references resolved
        """
        logger.info(f"analyze_project called with target_file: {target_file}")
        # Get the target file content
        target_code = files.get(target_file, "")
        if not target_code:
            logger.warning(f"Target file {target_file} not found in files dict")
            return self._empty_result()
        
        # Analyze the target file
        target_analysis = self.analyze(target_code, file_path=target_file)
        logger.info(f"Target file analysis: {len(target_analysis.get('functions', []))} functions")
        
        # Add import information to the analysis
        target_tree = self.parser.get_tree(target_code)
        if target_tree:
            imports = self.parser._extract_imports(target_tree, target_code)
            target_analysis["imports"] = imports
            logger.info(f"Extracted {len(imports)} imports")
        else:
            target_analysis["imports"] = []
        
        # Add files to project context for cross-file reference resolution
        project_context_with_files = project_context.copy()
        project_context_with_files["files"] = files
        project_context_with_files["target_file"] = target_file
        
        # Resolve cross-file references (with caching)
        cache_key = f"cross_ref_{target_file}_{len(files)}"
        cached_extended = self._get_cache(cache_key)
        
        if cached_extended:
            logger.info("Using cached cross-file analysis")
            extended_analysis = cached_extended
        else:
            logger.info("Computing cross-file references")
            extended_analysis = self.parser.resolve_cross_file_references(
                target_analysis, 
                project_context_with_files
            )
            # Cache the extended analysis
            self._put_cache(cache_key, extended_analysis)
        
        # Add the target file path to the analysis result so the highlighting service can use it
        extended_analysis["file_path"] = target_file
        
        logger.info(f"Extended analysis functions: {len(extended_analysis.get('functions', []))}")
        logger.info(f"Extended analysis callers_by_func keys: {list(extended_analysis.get('callers_by_func', {}).keys())}")
        
        return extended_analysis

    def _hash(self, code: str) -> str:
        return hashlib.sha256(code.encode("utf8")).hexdigest()

    def _get_cache(self, key: str) -> Optional[Dict[str, Any]]:
        if key not in self._cache:
            return None
        age_ms = (time.time() - self._cache_ts.get(key, 0)) * 1000
        if age_ms > settings.CACHE_TIMEOUT:
            # Expire
            del self._cache[key]
            del self._cache_ts[key]
            return None
        return self._cache[key]

    def _put_cache(self, key: str, value: Dict[str, Any]) -> None:
        self._cache[key] = value
        self._cache_ts[key] = time.time()

    def _normalize(self, result: Dict[str, Any]) -> Dict[str, Any]:
        """Ensure keys exist and metadata reflects actual counts."""
        if result is None:
            return self._empty_result()
        functions = result.get("functions") or []
        calls = result.get("calls") or []
        callers_by_func = result.get("callers_by_func") or {}
        metadata = result.get("metadata") or {}
        metadata["function_count"] = len(functions)
        metadata["call_count"] = len(calls)
        result["functions"] = functions
        result["calls"] = calls
        result["callers_by_func"] = callers_by_func
        result["metadata"] = metadata
        return result

    def _empty_result(self) -> Dict[str, Any]:
        return {
            "functions": [],
            "calls": [],
            "callers_by_func": {},
            "metadata": {"function_count": 0, "call_count": 0},
        }

    def _compute_full_edit(self, old_code: str, new_code: str) -> Dict[str, Any]:
        """Build a single full-buffer replacement edit for tree.edit()."""
        old_bytes = old_code.encode("utf8")
        new_bytes = new_code.encode("utf8")
        def byte_to_point(text: bytes, idx: int) -> Tuple[int, int]:
            prefix = text[:idx].decode("utf8", errors="ignore")
            lines = prefix.splitlines()
            if not lines:
                return (0, 0)
            row = len(lines) - 1
            col = len(lines[-1])
            return (row, col)
        return {
            "start_byte": 0,
            "old_end_byte": len(old_bytes),
            "new_end_byte": len(new_bytes),
            "start_point": (0, 0),
            "old_end_point": byte_to_point(old_bytes, len(old_bytes)),
            "new_end_point": byte_to_point(new_bytes, len(new_bytes)),
        }