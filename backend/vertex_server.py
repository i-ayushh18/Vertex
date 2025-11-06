"""
VERTEX Backend Server - Standalone executable entry point
"""
import sys
import os
import uvicorn
from pathlib import Path

# Add the backend directory to Python path
backend_dir = Path(__file__).parent
sys.path.insert(0, str(backend_dir))

def main():
    """Main entry point for the standalone server"""
    try:
        # Import after path setup
        from main import app
        
        print("Starting VERTEX Backend Server...")
        print("Server will be available at: http://localhost:8000")
        print("Use Ctrl+C to stop the server")
        
        # Run the server
        uvicorn.run(
            app, 
            host="127.0.0.1",  # Localhost only for security
            port=8000,
            log_level="info",
            access_log=False  # Reduce noise
        )
    except KeyboardInterrupt:
        print("\nVERTEX Backend Server stopped")
    except Exception as e:
        print(f"Failed to start server: {str(e)}")
        sys.exit(1)

if __name__ == "__main__":
    main()
