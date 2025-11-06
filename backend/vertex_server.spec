# -*- mode: python ; coding: utf-8 -*-
import os
import sys
from pathlib import Path

# Find tree-sitter-languages installation path
try:
    import tree_sitter_languages
    tsl_path = Path(tree_sitter_languages.__file__).parent
    
    # Include both the DLL and the PYD file
    binaries = [
        (str(tsl_path / "languages.dll"), 'tree_sitter_languages'),
        (str(tsl_path / "core.cp312-win_amd64.pyd"), 'tree_sitter_languages'),
    ]
    
    print(f"Found tree-sitter binaries: {binaries}")
except ImportError:
    binaries = []
    print("Warning: tree-sitter-languages not found")

block_cipher = None

a = Analysis(
    ['vertex_server.py'],
    pathex=[],
    binaries=binaries,  # Include tree-sitter binaries
    datas=[
        # Include all Python files
        ('app', 'app'),
        ('*.py', '.'),
    ],
    hiddenimports=[
        'uvicorn',
        'uvicorn.main',
        'uvicorn.server',
        'fastapi',
        'fastapi.middleware',
        'fastapi.middleware.cors',
        'fastapi.responses',
        'pydantic',
        'pydantic_settings',
        'tree_sitter',
        'tree_sitter_languages',
        'tree_sitter_languages.core',
        'logging',
        'json',
        'pathlib',
        'app.config',
        'app.models',
        'app.parser',
        'app.services.analysis_service',
        'app.services.highlighting_service',
        'app.services.deadcode_service',
        'app.services.codelens_service',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='vertex-server',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
