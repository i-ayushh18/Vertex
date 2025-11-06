"""Pydantic models for request/response validation."""
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any


class ProjectContext(BaseModel):
    """Project-Level Context for multi-file analysis"""
    project_root: str
    file_paths: List[str]
    import_map: Dict[str, str]
    symbol_table: Dict[str, List[Dict[str, Any]]]
    files: Optional[Dict[str, str]] = None

class AnalyzeRequest(BaseModel):
    """Request model for code analysis."""
    code: str = Field(..., description="Python source code to analyze")
    file_id: Optional[str] = Field(None, description="Unique file identifier (document URI)")
    files: Optional[Dict[str, str]] = Field(None, description="Project files for multi-file analysis")
    project_context: Optional[ProjectContext] = Field(None, description="Project context for multi-file analysis")
    target_file: Optional[str] = Field(None, description="Target file for analysis")


class HighlightRequest(BaseModel):
    """Request model for highlight information."""
    code: str = Field(..., description="Python source code")
    function_name: str = Field(..., description="Function to highlight")
    function_context: Optional[Dict[str, Any]] = Field(None, description="Function context with line/end_line")


class MultiFileAnalysisRequest(BaseModel):
    """Request for multi-file analysis"""
    files: Dict[str, str]
    project_context: ProjectContext
    target_file: str
    function_name: Optional[str] = None
    function_context: Optional[Dict[str, Any]] = None


class FunctionInfo(BaseModel):
    """Function definition information."""
    name: str
    line: int
    end_line: int


class CallInfo(BaseModel):
    """Function call information."""
    name: str
    line: int
    column: Optional[int] = None
    end_column: Optional[int] = None
    full_text: Optional[str] = None


class AnalysisMetadata(BaseModel):
    """Metadata about the analysis."""
    function_count: int
    call_count: int


class AnalysisResult(BaseModel):
    """Complete analysis result."""
    functions: List[FunctionInfo]
    calls: List[CallInfo]
    callers_by_func: Dict[str, List[Dict[str, int]]]  
    metadata: AnalysisMetadata


class HighlightRange(BaseModel):
    """Text range for highlighting."""
    line: int
    start_column: int
    end_column: int


class HighlightInfo(BaseModel):
    """Highlight information for a single occurrence."""
    line: int
    type: str  # "caller" or "callee"
    function_name: Optional[str] = None
    range: HighlightRange
    file_path: Optional[str] = None


class HighlightResult(BaseModel):
    """Complete highlight result."""
    callers: List[HighlightInfo]
    callees: List[HighlightInfo]
    total_callers: int
    total_callees: int


class NavigationResult(BaseModel):
    """Navigation result with precise position and state."""
    line: Optional[int]
    column: Optional[int] = None
    index: int
    total: int
    function_name: str
    message: str


class DeadFunction(BaseModel):
    """Dead/unused function information."""
    name: str
    line: int
    end_line: int
    message: str


class DeadCodeReport(BaseModel):
    """Dead code analysis report."""
    dead_functions: List[DeadFunction]
    total_unused: int
    total_functions: int


class CodeLensItem(BaseModel):
    """CodeLens item with caller/callee counts."""
    name: str
    line: int
    end_line: int
    caller_count: int
    callee_count: int
    title: str
    tooltip: str


class CodeLensResult(BaseModel):
    """Complete CodeLens result."""
    items: List[CodeLensItem]
    total_items: int