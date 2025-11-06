"""Highlighting service for caller/callee visual markers."""
import logging
from typing import Dict, List, Any, Optional

logger = logging.getLogger(__name__)


class HighlightingService:
    """
    Service for computing highlight ranges for callers and callees.

    - Callers: per-occurrence (from analysis['calls']), precise line+column.
    - Callees: within a provided function context (line..end_line), precise line+column.
    - Falls back to callers_by_func for line-only highlights if 'calls' is unavailable.
    """

    def __init__(self, analysis_result: Dict[str, Any]):
        self.analysis = analysis_result or {}

    def get_highlights(
        self,
        function_name: str,
        function_context: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Get both caller and callee highlights (if context provided).
        - function_name: the function we're locked to (callers will be for this name)
        - function_context: {'line': int, 'end_line': int} to compute callees inside that scope
        """
        callers = self._get_caller_highlights(function_name)
        callees = self._get_callee_highlights(function_context) if function_context else []

        result = {
            "callers": callers,
            "callees": callees,
            "total_callers": len(callers),
            "total_callees": len(callees),
        }
        logger.debug(
            f"Highlights for '{function_name}': callers={len(callers)} callees={len(callees)}"
        )
        return result

    def _get_caller_highlights(self, function_name: str) -> List[Dict[str, Any]]:
        """
        Build caller highlights from analysis['calls'] (per-occurrence).
        Fallback: callers_by_func lines if calls not present.
        """
        highlights: List[Dict[str, Any]] = []
        calls = self.analysis.get("calls", [])
        logger.info(f"Processing {len(calls)} calls for function {function_name}")
        logger.info(f"Available calls: {[call.get('name') for call in calls]}")
        if isinstance(calls, list) and len(calls) > 0:
            # Per-occurrence (handles multiple calls per line)
            for call in calls:
                call_name = call.get("name")
                logger.info(f"Checking call: {call_name} against target: {function_name}")
                if call_name != function_name:
                    continue
                line = call.get("line")
                col = call.get("column")
                end_col = call.get("end_column", (col + len(function_name) if isinstance(col, int) else None))

                if isinstance(line, int) and isinstance(col, int) and isinstance(end_col, int):
                    highlight = {
                        "line": line,
                        "type": "caller",
                        "function_name": function_name,
                        "range": {"line": line, "start_column": col, "end_column": end_col}
                    }
                    
                    # Always include file path - for cross-file callers, use the call's file_path
                    # for regular callers, use the target file from the analysis
                    if call.get("is_cross_file"):
                        file_path = call.get("file_path")
                        if file_path:
                            highlight["file_path"] = file_path
                            logger.info(f"Adding cross-file caller with file path: {file_path}")
                        else:
                            logger.warning(f"Cross-file caller missing file_path: {call}")
                    else:
                        # For regular callers, use the file where the analysis was performed
                        # This should be passed in the analysis context
                        file_path = self.analysis.get("file_path")  # This will be set by analyze_project
                        if file_path:
                            highlight["file_path"] = file_path
                            logger.info(f"Adding regular caller with file path: {file_path}")
                        else:
                            logger.info(f"Adding regular caller without file path")
                        
                    highlights.append(highlight)

        logger.info(f"Found {len(highlights)} highlights from calls array")
        
        # Fallback to callers_by_func (line only), if no per-call highlights
        if not highlights:
            caller_positions = self.analysis.get("callers_by_func", {}).get(function_name, [])
            logger.info(f"Falling back to callers_by_func with {len(caller_positions)} positions")
            for pos in caller_positions:
                if isinstance(pos, dict):
                    line = pos.get("line", 0)
                    col = pos.get("column")
                    end_col = pos.get("end_column")
                else:
                    # Legacy support (line only)
                    line = pos
                    col = None
                    end_col = None

                highlight = {
                    "line": line,
                    "type": "caller",
                    "function_name": function_name,
                    "range": self._build_range(line, function_name, col, end_col)
                }
                
                # Include file path for cross-file callers
                if isinstance(pos, dict) and pos.get("is_cross_file"):
                    file_path = pos.get("file_path")
                    if file_path:
                        highlight["file_path"] = file_path
                        logger.info(f"Adding cross-file caller from callers_by_func with file path: {file_path}")
                    else:
                        logger.warning(f"Cross-file caller from callers_by_func missing file_path: {pos}")
                else:
                    # For regular callers, use the file where the analysis was performed
                    file_path = self.analysis.get("file_path")  # This will be set by analyze_project
                    if file_path:
                        highlight["file_path"] = file_path
                        logger.info(f"Adding regular caller with file path: {file_path}")
                    
                highlights.append(highlight)

        logger.info(f"Returning {len(highlights)} total highlights")
        return highlights

    def _get_callee_highlights(
        self,
        function_context: Optional[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """
        Return callees invoked within the provided function context (line..end_line), per-occurrence.
        Only highlights user-defined functions, not built-in functions.
        """
        if not function_context:
            return []
        start_line = function_context.get("line", 0)
        end_line = function_context.get("end_line", 0)
        if start_line <= 0 or end_line <= 0:
            return []

        highlights: List[Dict[str, Any]] = []
        calls = self.analysis.get("calls", [])
        
        # Get the list of user-defined functions from the analysis
        user_defined_functions = {f["name"] for f in self.analysis.get("functions", [])}

        for call in calls:
            line = call.get("line", 0)
            if not isinstance(line, int) or line <= 0:
                continue
            if start_line <= line <= end_line:
                name = call.get("name", "")
                # Only highlight user-defined functions, not built-in functions
                if name in user_defined_functions:
                    col = call.get("column")
                    end_col = call.get("end_column", (col + len(name) if isinstance(col, int) else None))

                    if isinstance(col, int) and isinstance(end_col, int):
                        highlights.append({
                            "line": line,
                            "type": "callee",
                            "function_name": name,
                            "range": {"line": line, "start_column": col, "end_column": end_col}
                        })

        return highlights

    def _build_range(
        self,
        line: int,
        function_name: str,
        column: Optional[int] = None,
        end_column: Optional[int] = None
    ) -> Dict[str, int]:
        """
        Build precise text range for highlighting.
        - If end_column not provided, compute using the function name length.
        """
        start_column = column if isinstance(column, int) and column >= 0 else 0
        if isinstance(end_column, int) and end_column >= start_column:
            calculated_end = end_column
        else:
            calculated_end = start_column + len(function_name)

        return {
            "line": line,
            "start_column": start_column,
            "end_column": calculated_end
        }