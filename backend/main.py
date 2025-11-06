"""Main FastAPI application with all endpoints."""
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
import logging
import time
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.models import (
    AnalyzeRequest,
    HighlightRequest,
    AnalysisResult,
    HighlightResult,
    DeadCodeReport,
    CodeLensResult,
    CodeLensItem,
    MultiFileAnalysisRequest
)
from app.parser import PythonParser
from app.services.analysis_service import AnalysisService
from app.services.highlighting_service import HighlightingService
from app.services.deadcode_service import DeadCodeService
from app.services.codelens_service import CodeLensService



# ==================== Setup ====================

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# settings = get_settings()

app = FastAPI(
    title="VERTEX Backend",
    description="Visual Execution Reference Tracking EXtension - Python Analysis Backend",
    version="0.1.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Instantiate services ONCE for reuse
analysis_service = AnalysisService()
parser = PythonParser()

# ==================== Middleware ====================

@app.middleware("http")
async def log_requests(request: Request, call_next):
    start_time = time.time()
    logger.info(f"→ {request.method} {request.url.path}")
    response = await call_next(request)
    process_time = (time.time() - start_time) * 1000
    logger.info(
        f"← {request.method} {request.url.path} "
        f"[{response.status_code}] {process_time:.2f}ms"
    )
    response.headers["X-Process-Time"] = str(process_time)
    return response


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled exception: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={
            "detail": "Internal server error",
            "error": str(exc),
            "type": type(exc).__name__
        }
    )


# ==================== Endpoints ====================

@app.get("/health")
def health_check():
    return {"status": "ok", "service": "VERTEX Backend", "version": "0.1.0"}


@app.post("/analyze", response_model=AnalysisResult)
async def analyze_code(request: AnalyzeRequest):
    try:
        result = analysis_service.analyze(request.code, file_path=request.file_id)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/highlight", response_model=HighlightResult)
async def highlight(request: HighlightRequest):
    try:
        analysis = analysis_service.analyze(request.code, file_path=getattr(request, "file_id", None))
        hs = HighlightingService(analysis)
        # function_context may be passed through the request
        ctx = getattr(request, "function_context", None)
        result = hs.get_highlights(request.function_name, function_context=ctx)
        return result
    except Exception as e:
        logger.error("Highlight failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Highlight error: {e}")

@app.post("/deadcode", response_model=DeadCodeReport)
async def deadcode(request: AnalyzeRequest):
    try:
        logger.info(f"Deadcode endpoint called with request: {request}")
        if request.files and request.project_context and request.target_file:
            logger.info(f"Performing multi-file analysis on {len(request.files)} files")
            
            # Safety check: Limit file count to prevent memory issues
            if len(request.files) > 1000:
                logger.warning(f"Too many files ({len(request.files)}), limiting to 1000")
                limited_files = dict(list(request.files.items())[:1000])
                analysis = analysis_service.analyze_project(
                    limited_files, 
                    request.project_context.dict(), 
                    request.target_file
                )
            else:
                # Multi-file analysis
                analysis = analysis_service.analyze_project(
                    request.files, 
                    request.project_context.dict(), 
                    request.target_file
                )
        else:
            logger.info("Performing single-file analysis")
            # Single file analysis (backward compatibility)
            analysis = analysis_service.analyze(request.code, file_path=request.file_id)
        
        logger.info(f"Analysis result: {analysis}")
        # Create DeadCodeService with analysis result
        dsvc = DeadCodeService(analysis.dict() if hasattr(analysis, "dict") else analysis)
        
        # Generate and return report
        report = dsvc.get_report()
        logger.info(f"Dead code report: {report}")
        return DeadCodeReport(**report)
    except Exception as e:
        logger.error(f"Deadcode failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Deadcode error: {e}")

@app.post("/codelens", response_model=CodeLensResult)
async def codelens(request: AnalyzeRequest):
    try:
        # Check if this is a multi-file request with project context
        if request.files and request.project_context and request.target_file:
            # Multi-file analysis with cross-file reference resolution
            analysis = analysis_service.analyze_project(
                request.files, 
                request.project_context.dict(), 
                request.target_file
            )
        else:
            # Single file analysis (backward compatibility)
            analysis = analysis_service.analyze(request.code, file_path=request.file_id)

        # Convert if analysis is a Pydantic model
        if hasattr(analysis, "dict"):
            analysis = analysis.dict()

        # Step 2: Build codelens using CodeLensService
        svc = CodeLensService(analysis)
        items = svc.get_codelens_data()

        # Step 3: Wrap it using your Pydantic model
        return CodeLensResult(
            items=[CodeLensItem(**item) for item in items],
            total_items=len(items)
        )

    except Exception as e:
        logger.error(f"CodeLens generation failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"CodeLens error: {str(e)}")

@app.post("/analyze-project", response_model=AnalysisResult)
async def analyze_project(request: MultiFileAnalysisRequest):
    """Analyze multiple files in a project."""
    try:
        result = analysis_service.analyze_project(
            request.files, 
            request.project_context.dict(), 
            request.target_file
        )
        return result
    except Exception as e:
        logger.error(f"Project Analysis failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Project Analysis error: {e}")

@app.post("/extract-highlights", response_model=HighlightResult)
async def extract_highlights(request: MultiFileAnalysisRequest):
    """Extract highlights from project analysis with cross-file references."""
    try:
        # Analyze the project to get cross-file references
        analysis = analysis_service.analyze_project(
            request.files, 
            request.project_context.dict(), 
            request.target_file
        )
        
        # Extract highlights using the highlighting service
        hs = HighlightingService(analysis)
        result = hs.get_highlights(
            request.function_name, 
            function_context=request.function_context
        )
        return result
    except Exception as e:
        logger.error(f"Highlight extraction failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Highlight extraction error: {e}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)