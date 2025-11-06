#!/usr/bin/env python3
"""
Test runner for VERTEX backend services
"""

import subprocess
import sys
from pathlib import Path

def run_python_script(script_path, description):
    """Run a Python script and return the result"""
    try:
        print(f"\n{'='*60}")
        print(f"Running {description}")
        print('='*60)
        
        # Change to the backend directory
        backend_dir = Path(__file__).parent
        script_full_path = backend_dir / script_path
        
        if not script_full_path.exists():
            print(f"❌ Script not found: {script_full_path}")
            return False
            
        result = subprocess.run([
            sys.executable, 
            str(script_full_path)
        ], cwd=backend_dir, capture_output=True, text=True)
        
        if result.returncode == 0:
            print(result.stdout)
            print("✅ Test completed successfully")
            return True
        else:
            print("STDOUT:")
            print(result.stdout)
            print("STDERR:")
            print(result.stderr)
            print("❌ Test failed")
            return False
    except Exception as e:
        print(f"❌ Failed to run {description}: {e}")
        return False

def run_test_script(script_name):
    """Run a Python test script and return the result"""
    try:
        print(f"\n{'='*60}")
        print(f"Running {script_name}")
        print('='*60)
        
        # Change to the backend directory
        backend_dir = Path(__file__).parent
        result = subprocess.run([
            sys.executable, 
            str(backend_dir / "tests" / script_name)
        ], cwd=backend_dir, capture_output=True, text=True)
        
        if result.returncode == 0:
            print(result.stdout)
            print("✅ Test completed successfully")
            return True
        else:
            print("STDOUT:")
            print(result.stdout)
            print("STDERR:")
            print(result.stderr)
            print("❌ Test failed")
            return False
    except Exception as e:
        print(f"❌ Failed to run {script_name}: {e}")
        return False

def main():
    """Run all backend tests"""
    print("VERTEX Backend Test Runner")
    print("=" * 60)
    
    # Make sure the tests directory exists
    tests_dir = Path(__file__).parent / "tests"
    if not tests_dir.exists():
        print("❌ Tests directory not found")
        return 1
    
    # Check if we're running specific tests or all tests
    if len(sys.argv) > 1:
        # Run specific test
        test_name = sys.argv[1]
        if test_name == "integration":
            success = run_python_script("tests/test_navigation_integration.py", "Navigation Integration Test")
        elif test_name == "features":
            success = run_test_script("test_vertex_features.py")
        else:
            print(f"Unknown test: {test_name}")
            print("Available tests: integration, features")
            return 1
    else:
        # Run all tests
        print("Running all tests...")
        
        tests = [
            ("tests/test_vertex_features.py", "Main Feature Tests"),
            ("tests/test_navigation_integration.py", "Navigation Integration Test")
        ]
        
        results = []
        for test_path, description in tests:
            success = run_python_script(test_path, description)
            results.append(success)
        
        print("\n" + "=" * 60)
        print("Test Summary:")
        all_passed = all(results)
        print(f"Overall: {'✅ ALL TESTS PASSED' if all_passed else '❌ SOME TESTS FAILED'}")
        
        return 0 if all_passed else 1

if __name__ == "__main__":
    sys.exit(main())