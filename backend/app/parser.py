"""Tree-sitter based Python code parser using tree-sitter-languages."""
import logging
from typing import Dict, List, Any, Optional, Set
import re

logger = logging.getLogger(__name__)

# Import tree-sitter components
try:
    from tree_sitter_languages import get_parser, get_language
    from tree_sitter import Node, Tree
    TREE_SITTER_AVAILABLE = True
    logger.info("tree-sitter-languages imported successfully")
except ImportError as e:
    logger.error(f"tree-sitter-languages not available: {e}")
    TREE_SITTER_AVAILABLE = False


class PythonParser:
    """
    Parser for Python source code using tree-sitter.

    Produces precise function and call positions for highlighting/navigation:
    - functions: [{name, line, end_line, start_column, end_column}]
    - calls:     [{name, line, column, end_column, full_text, receiver, caller_function}]
    """

    def __init__(self):
        """Initialize the parser with Python language support."""
        if not TREE_SITTER_AVAILABLE:
            raise RuntimeError(
                "tree-sitter libraries not installed. "
                "Run: pip install tree-sitter-languages"
            )
        try:
            self.parser = get_parser('python')
            if not self.parser:
                raise RuntimeError("Failed to get Python parser from tree-sitter-languages")
            self.language = get_language('python')
            logger.info("✅ Python parser initialized successfully")
        except Exception as e:
            logger.error(f"❌ Failed to initialize parser: {e}")
            raise RuntimeError(f"Parser initialization failed: {e}") from e

    # ==================== Main Parsing Methods ====================

    def get_tree(self, code: str) -> Optional[Tree]:
        """Get raw Tree-sitter Tree object without analysis."""
        if not code or not code.strip():
            logger.debug("Empty code provided to get_tree")
            return None
        try:
            tree = self.parser.parse(bytes(code, "utf8"))
            if not tree or not tree.root_node:
                logger.warning("Parser returned invalid tree")
                return None
            return tree
        except Exception as e:
            logger.error(f"Failed to get tree: {e}")
            return None

    def analyze_tree(self, tree: Optional[Tree], code: str = "") -> Dict[str, Any]:
        """Analyze an existing Tree-sitter Tree object."""
        if not tree:
            logger.debug("No tree provided to analyze_tree")
            return self._empty_result()
        try:
            result = self._analyze_tree(tree, code)
            logger.info(
                f" Analyzed tree: {result['metadata']['function_count']} functions, "
                f"{result['metadata']['call_count']} calls"
            )
            return result
        except Exception as e:
            logger.error(f"Failed to analyze tree: {e}")
            return self._empty_result()

    # ==================== Tree Analysis (Internal) ====================

    def _analyze_tree(self, tree: Tree, code: str) -> Dict[str, Any]:
        """
        Walk the CST and extract function definitions and calls with precise positions.
        """
        functions: List[Dict[str, Any]] = []
        calls: List[Dict[str, Any]] = []

        # Maintain a simple function stack to capture caller_function for calls
        func_stack: List[str] = []

        def walk(node: Node):
            nonlocal func_stack

            # ==================== Extract Function Definitions ====================
            if node.type == "function_definition":
                name_node = node.child_by_field_name("name")
                if name_node:
                    func_name = name_node.text.decode("utf8")
                    functions.append({
                        "name": func_name,
                        "line": node.start_point[0] + 1,          # Convert to 1-based
                        "end_line": node.end_point[0] + 1,        # Convert to 1-based
                        "start_column": node.start_point[1],
                        "end_column": node.end_point[1]
                    })
                    # Enter new function scope
                    func_stack.append(func_name)
                    # Walk children before popping
                    for child in node.children:
                        walk(child)
                    # Exit scope
                    func_stack.pop()
                    return  # already walked children, don't fall through

            # ==================== Extract Function Calls ====================
            if node.type == "call":
                fn_node = node.child_by_field_name("function")
                if fn_node:
                    # Full call text: e.g., "obj.method" or "func"
                    call_text = fn_node.text.decode("utf8")
                    parts = call_text.split(".")
                    call_name = parts[-1]
                    receiver = parts[0] if len(parts) > 1 else None

                    # Column at identifier (method/function name), not the receiver
                    if "." in call_text:
                        dot_index = call_text.rfind(".")
                        start_col = node.start_point[1] + dot_index + 1
                    else:
                        start_col = node.start_point[1]

                    end_col = start_col + len(call_name)

                    calls.append({
                        "name": call_name,
                        "line": node.start_point[0] + 1,
                        "column": start_col,
                        "end_column": end_col,
                        "full_text": call_text,
                        "receiver": receiver,
                        "caller_function": func_stack[-1] if func_stack else None
                    })

            # Recursively process children
            for child in node.children:
                walk(child)

        # Start walking from root
        walk(tree.root_node)

        # Build callers_by_func with precise positions
        callers_by_func: Dict[str, List[Dict[str, int]]] = {}
        func_names: Set[str] = {f["name"] for f in functions}
        # Detect decorated functions in the source using a simple regex.
        # This captures patterns like:
        # @logger
        # def do_work(...):
        # It also supports dotted decorators like @mod.logger
        decorated_map: Dict[str, List[str]] = {}
        try:
            for m in re.finditer(r"@(?:\w+\.)*(?P<decorator>\w+)\s*\n\s*def\s+(?P<fname>\w+)", code):
                deco = m.group("decorator")
                fname = m.group("fname")
                decorated_map.setdefault(fname, []).append(deco)
        except Exception:
            decorated_map = {}
        decorator_inner_map: Dict[str, List[str]] = {}
        for outer in functions:
            outer_name = outer.get("name")
            outer_start = outer.get("line", 0)
            outer_end = outer.get("end_line", 0)
            inners: List[str] = []
            for inner in functions:
                if inner.get("name") == outer_name:
                    continue
                il = inner.get("line", 0)
                ie = inner.get("end_line", 0)
                if il >= outer_start and ie <= outer_end:
                    inners.append(inner.get("name"))
            if inners:
                decorator_inner_map[outer_name] = inners

        for call in calls:
            if call["name"] in func_names:
                # Store precise position instead of just line number
                callers_by_func.setdefault(call["name"], []).append({
                    "line": call["line"],
                    "column": call.get("column"),
                    "end_column": call.get("end_column")
                })
                decos = decorated_map.get(call["name"], [])
                for deco in decos:
                    inner_funcs = decorator_inner_map.get(deco, [])
                    for inner_name in inner_funcs:
                        callers_by_func.setdefault(inner_name, []).append({
                            "line": call["line"],
                            "column": call.get("column"),
                            "end_column": call.get("end_column")
                        })

        return {
            "functions": functions,
            "calls": calls,
            "callers_by_func": callers_by_func,
            "metadata": {
                "function_count": len(functions),
                "call_count": len(calls)
            }
        }

    # ==================== Utility Methods ====================

    def _empty_result(self) -> Dict[str, Any]:
        """Return an empty analysis result."""
        return {
            "functions": [],
            "calls": [],
            "callers_by_func": {},
            "metadata": {
                "function_count": 0,
                "call_count": 0
            }
        }


    def _extract_imports(self, tree: Tree, code: str) -> List[Dict[str, str]]:
        """
        Extract import statements and resolve module paths.
        Returns list of imports with resolved module and alias.
        """
        imports = []

        def walk(node: Node):
            # Case 1: import x, y as z
            if node.type == "import_statement":
                for child in node.children:
                    # Example: import os, sys as system
                    if child.type == "aliased_import":
                        module_node = child.child_by_field_name("name")
                        alias_node = child.child_by_field_name("alias")
                        if module_node:
                            module = module_node.text.decode("utf-8")
                            alias = alias_node.text.decode("utf-8") if alias_node else None
                            imports.append({
                                "type": "import",
                                "module": module,
                                "alias": alias,
                            })
                    elif child.type == "dotted_name":
                        # Example: import os
                        module = child.text.decode("utf-8")
                        imports.append({
                            "type": "import",
                            "module": module,
                            "alias": None,
                        })

            # Case 2: from x import y as z
            elif node.type == "import_from_statement":
                module_node = node.child_by_field_name("module_name")
                imported_names = node.child_by_field_name("names")

                if module_node:
                    module_name = module_node.text.decode("utf-8")

                    # Go through imported names
                    if imported_names:
                        for name_child in imported_names.children:
                            if name_child.type == "aliased_import":
                                symbol = name_child.child_by_field_name("name")
                                alias = name_child.child_by_field_name("alias")
                                imports.append({
                                    "type": "from_import",
                                    "module": module_name,
                                    "import": symbol.text.decode("utf-8") if symbol else None,
                                    "alias": alias.text.decode("utf-8") if alias else None
                                })
                            elif name_child.type == "identifier":
                                imports.append({
                                    "type": "from_import",
                                    "module": module_name,
                                    "import": name_child.text.decode("utf-8"),
                                    "alias": None
                                })

            # Recurse into children
            for child in node.children:
                walk(child)

        if tree and tree.root_node:
            walk(tree.root_node)

        return imports

    def resolve_cross_file_references(self, current_file_analysis: Dict[str, Any], project_context: Dict[str, Any]) -> Dict[str, Any]:
        """Resolve cross file references"""
        extended_analysis = current_file_analysis.copy()

        symbol_table = project_context.get("symbol_table", {})
        import_map = project_context.get("import_map", {})
        
        logger.info(f"Resolving cross-file references for target file: {project_context.get('target_file', 'Unknown')}")
        logger.info(f"Symbol table keys: {list(symbol_table.keys())}")
        logger.info(f"Import map: {import_map}")
        
        # Build module aliases map
        module_aliases = {}
        for imp in extended_analysis.get("imports", []):
            if imp["type"] == "import" and imp.get("alias"):
                module_aliases[imp["alias"]] = imp["module"]
            elif imp["type"] == "from_import" and imp.get("alias"):
                module_aliases[imp["alias"]] = f"{imp['module']}.{imp['import']}"

        # Process calls to identify cross-file references
        resolved_calls = []
        for call in extended_analysis.get("calls", []):
            call_name = call.get("name", "")
            receiver = call.get("receiver", None)

            
            # Check if this is a cross-file call
            is_cross_file = False
            target_file = None
            
            # Case 1: Direct import like "import utils" followed by "utils.calculate_area()"
            if receiver and receiver in import_map:
                module_path = import_map[receiver]
                # Check if the function exists in the imported module
                if call_name in symbol_table:
                    for symbol in symbol_table[call_name]:
                        if symbol.get("file_path") == module_path:
                            is_cross_file = True
                            target_file = module_path
                            break
            
            # Case 2: Aliased import like "import utils as u" followed by "u.calculate_area()"
            elif receiver and receiver in module_aliases:
                actual_module = module_aliases[receiver]
                if actual_module in import_map:
                    module_path = import_map[actual_module]
                    # Check if the function exists in the imported module
                    if call_name in symbol_table:
                        for symbol in symbol_table[call_name]:
                            if symbol.get("file_path") == module_path:
                                is_cross_file = True
                                target_file = module_path
                                break
            
            # Case 3: From import like "from utils import calculate_area" followed by "calculate_area()"
            elif not receiver:  # Direct function call
                # Check if this function is imported from another module
                for imp in extended_analysis.get("imports", []):
                    if (imp["type"] == "from_import" and 
                        imp.get("import") == call_name and 
                        imp.get("module") in import_map):
                        module_path = import_map[imp["module"]]
                        # Check if the function exists in the imported module
                        if call_name in symbol_table:
                            for symbol in symbol_table[call_name]:
                                if symbol.get("file_path") == module_path:
                                    is_cross_file = True
                                    target_file = module_path
                                    break
                        if is_cross_file:
                            break
            
            # Add cross-file information to the call
            if is_cross_file:
                call["is_cross_file"] = True
                call["file_path"] = target_file
                logger.info(f"Marked call as cross-file: {call_name} in {target_file}")
            else:
                logger.info(f"Regular call: {call_name} (receiver: {receiver})")
            
            resolved_calls.append(call)

        extended_analysis["calls"] = resolved_calls
        logger.info(f"Resolved calls: {len(resolved_calls)} total calls")

        # Update callers_by_func to include cross-file callers
        extended_callers_by_func = extended_analysis.get("callers_by_func", {}).copy()
        
        # Also update the calls array to include cross-file information
        updated_calls = extended_analysis.get("calls", []).copy()
        logger.info(f"Starting with {len(updated_calls)} calls from target file")
        
        # Process all files in the project to find cross-file callers
        files = project_context.get("files", {})
        logger.info(f"Processing cross-file references for {len(files)} files")
        for file_path, file_content in files.items():
            logger.info(f"Analyzing file: {file_path}")
            if file_path == project_context.get("target_file", ""):
                # Skip the target file as we've already processed it
                logger.info(f"Skipping target file: {file_path}")
                continue
                
            # Parse the other file to find calls to functions in the target file
            try:
                other_tree = self.get_tree(file_content)
                if other_tree:
                    other_imports = self._extract_imports(other_tree, file_content)
                    
                    # Build import map for this file
                    file_import_map = {}
                    for imp in other_imports:
                        if imp["type"] == "import":
                            file_import_map[imp["module"]] = imp["module"]
                            if imp.get("alias"):
                                file_import_map[imp["alias"]] = imp["module"]
                        elif imp["type"] == "from_import" and imp.get("module"):
                            file_import_map[imp["module"]] = imp["module"]
                            if imp.get("import") and imp.get("alias"):
                                file_import_map[imp["alias"]] = f"{imp['module']}.{imp['import']}"
                    
                    logger.info(f"File {file_path} imports: {file_import_map}")
                    
                    # Analyze the other file
                    other_analysis = self.analyze_tree(other_tree, file_content)
                    
                    # Check calls in the other file
                    for call in other_analysis.get("calls", []):
                        call_name = call.get("name", "")
                        receiver = call.get("receiver", None)
                        
                        logger.info(f"Checking call {call_name} with receiver {receiver} in file {file_path}")
                        # Check if this call targets a function that is defined in our target file
                        target_function_found = False
                        if call_name in symbol_table:
                            for symbol in symbol_table[call_name]:
                                if symbol.get("file_path") == project_context.get("target_file", ""):
                                    target_function_found = True
                                    logger.info(f"Found target function {call_name} in target file {project_context.get('target_file', '')}")
                                    break
                        
                        if target_function_found:
                            logger.info(f"Found cross-file caller: {call_name} at line {call.get('line')} in {file_path}")
                            # This is a cross-file caller - the CALLER is in the current file (file_path)
                            # and it's calling a function defined in the target file
                            call_with_file_info = call.copy()
                            call_with_file_info["is_cross_file"] = True
                            # The file_path should be the file where the CALL is made, not where the function is defined
                            call_with_file_info["file_path"] = file_path
                            updated_calls.append(call_with_file_info)
                            
                            # Add this cross-file caller to the callers_by_func map
                            # This is the key fix - we need to add cross-file callers to callers_by_func
                            extended_callers_by_func.setdefault(call_name, []).append({
                                "line": call.get("line"),
                                "column": call.get("column"),
                                "end_column": call.get("end_column"),
                                "file_path": file_path  # Track which file this caller is from
                            })
                        else:
                            logger.info(f"Not a cross-file caller: {call_name} in {file_path} (target function not found)")
            except Exception as e:
                logger.warning(f"Failed to analyze file {file_path} for cross-file references: {e}")

        extended_analysis["callers_by_func"] = extended_callers_by_func
        extended_analysis["calls"] = updated_calls
        logger.info(f"Final callers_by_func: {extended_callers_by_func}")

        return extended_analysis    