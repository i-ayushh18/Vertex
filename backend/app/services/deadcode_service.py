"""Dead code detection service."""
import logging
from typing import Dict, List, Any

logger = logging.getLogger(__name__)


class DeadCodeService:
    """
    Service for detecting unused (dead) functions.
    
    Identifies functions with zero callers that may be safe to delete.
    """
    
    def __init__(self, analysis_result: Dict[str, Any]):
        """
        Initialize dead code service.
        
        Args:
            analysis_result: Complete analysis from parser
        """
        self.analysis = analysis_result or {}
        # Debug logging to see what we're receiving
        logger.info(f"DeadCodeService initialized with analysis: {list(self.analysis.keys()) if self.analysis else 'None'}")
        if self.analysis:
            logger.info(f"Functions count: {len(self.analysis.get('functions', []))}")
            logger.info(f"Callers by func keys: {list(self.analysis.get('callers_by_func', {}).keys())}")
    
    def get_report(self) -> Dict[str, Any]:
        """
        Generate complete dead code report.
        
        Returns:
            Dictionary with dead functions list and statistics
        """
        dead_functions = self._find_unused_functions()
        total_functions = len(self.analysis.get("functions", []))
        
        logger.info(
            f"Dead code analysis: {len(dead_functions)} unused "
            f"out of {total_functions} total functions"
        )
        
        return {
            "dead_functions": dead_functions,
            "total_unused": len(dead_functions),
            "total_functions": total_functions
        }
    
    def _find_unused_functions(self) -> List[Dict[str, Any]]:
        """
        Find all functions with zero callers.
        
        Returns:
            List of dead function info dictionaries
        """
        functions = self.analysis.get("functions", [])
        callers_map = self.analysis.get("callers_by_func", {})
        dead_functions = []
        logger.info(f"DEBUG: Functions found: {[f.get('name') for f in functions]}")
        logger.info(f"DEBUG: Callers map keys: {list(callers_map.keys())}")    
        
        # Exclusion list for common entry points
        excluded_names = {"main", "__init__", "__main__"}
        
        for func in functions:
            func_name = func.get("name")
            
            # Skip if no name or in exclusion list
            if not func_name or func_name in excluded_names:
                continue
            
            # Skip special methods (dunder methods)
            if func_name.startswith("__") and func_name.endswith("__"):
                continue
            
            # Check if function has any callers
            caller_lines = callers_map.get(func_name, [])
            logger.info(f"DEBUG: Function {func_name} has {len(caller_lines)} callers")
            
            if not caller_lines:
                dead_functions.append({
                    "name": func_name,
                    "line": func["line"],
                    "end_line": func["end_line"],
                    "message": f"Unused function '{func_name}' (0 callers) - safe to delete?"
                })
                logger.debug(f"Found unused function: {func_name} at line {func['line']}")
        return dead_functions