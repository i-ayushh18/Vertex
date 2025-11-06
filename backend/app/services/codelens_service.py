"""CodeLens service for inline caller/callee counts."""
import logging
from typing import Dict, List, Any

logger = logging.getLogger(__name__)


class CodeLensService:
    """
    Service for generating CodeLens information.
    
    Provides caller/callee counts and navigation hints for each function.
    """
    
    def __init__(self, analysis_result: Dict[str, Any]):
        """
        Initialize CodeLens service.
        
        Args:
            analysis_result: Complete analysis from parser
        """
        self.analysis = analysis_result or {}
    
    def get_codelens_data(self) -> List[Dict[str, Any]]:
        """
        Generate CodeLens items for all functions.
        
        Returns:
            List of CodeLens item dictionaries with counts and metadata
        """
        # Try multiple shapes to be robust
        functions = self.analysis.get("functions")
        if functions is None:
            # Sometimes results are nested due to upstream wrappers
            functions = self.analysis.get("analysis", {}).get("functions")
        if functions is None:
            functions = []
        
        calls = self.analysis.get("calls") or self.analysis.get("analysis", {}).get("calls") or []
        callers_map = self.analysis.get("callers_by_func") or self.analysis.get("analysis", {}).get("callers_by_func") or {}

        # Logging for debugging
        try:
            logger.info(f"[CodeLens] analysis keys: {list(self.analysis.keys())}")
            logger.info(f"[CodeLens] functions count: {len(functions)}  calls count: {len(calls)}  callers_map size: {len(callers_map)}")
        except Exception:
            logger.warning("[CodeLens] Failed to log analysis keys")

        codelens_items: List[Dict[str, Any]] = []

        if not isinstance(functions, list) or len(functions) == 0:
            logger.warning("[CodeLens] No functions available in analysis; returning 0 items")
            return codelens_items
        
        for func in functions:
            # Guard against malformed entries
            func_name = func.get("name") or func.get("full_name")
            func_line = func.get("line")
            func_end_line = func.get("end_line")
            if not func_name or not isinstance(func_line, int) or not isinstance(func_end_line, int):
                logger.debug(f"[CodeLens] Skipping malformed function entry: {func}")
                continue
            
            # Count callers (who calls this function) - callers_map is keyed by short name in current parser
            caller_count = len(callers_map.get(func_name, []))

            # Count callees (what this function calls)
            callee_count = self._count_callees_in_range(
                calls, func_line, func_end_line
            )
            
            # Build CodeLens item
            item = {
                "name": func_name,
                "line": func_line,
                "end_line": func_end_line,
                "caller_count": caller_count,
                "callee_count": callee_count,
                "title": self._build_title(caller_count, callee_count),
                "tooltip": self._build_tooltip(func_name, caller_count, callee_count)
            }
            codelens_items.append(item)
            logger.debug(f"[CodeLens] Built item for {func_name}: callers={caller_count}, callees={callee_count}")
        
        logger.info(f"Generated {len(codelens_items)} CodeLens items")
        return codelens_items
    
    def _count_callees_in_range(
        self, 
        calls: List[Dict[str, Any]], 
        start_line: int, 
        end_line: int
    ) -> int:
        """
        Count callees in range, only counting user-defined functions, not built-in functions.
        """
        count = 0
        
        # Get the list of user-defined functions from the analysis
        user_defined_functions = {f["name"] for f in self.analysis.get("functions", [])}
        
        for call in calls:
            call_line = call.get("line", 0)
            call_name = call.get("name", "")
            # Only count user-defined functions, not built-in functions
            if (isinstance(call_line, int) and start_line <= call_line <= end_line and 
                call_name in user_defined_functions):
                count += 1
        return count
    
    def _build_title(self, caller_count: int, callee_count: int) -> str:
        return f"↑ {caller_count} callers • ↓ {callee_count} callees"
    
    def _build_tooltip(
        self, 
        function_name: str, 
        caller_count: int, 
        callee_count: int
    ) -> str:
        tooltip_parts = [
            f"Function: {function_name}",
            f"Called by {caller_count} location(s)",
            f"Calls {callee_count} function(s)"
        ]
        
        if caller_count > 0:
            tooltip_parts.append("Click to navigate to callers")
        else:
            tooltip_parts.append(" Unused function - consider removing")
        
        return " | ".join(tooltip_parts)
    