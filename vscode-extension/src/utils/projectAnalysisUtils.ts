import * as vscode from 'vscode';
import * as path from 'path';
import { getConfig } from '../config';

export async function collectProjectFiles(): Promise<Record<string, string>> {
    const files: Record<string, string> = {};
    const config = getConfig();
    
    // Build exclusion pattern from config
    const excludePatterns = [
        '**/node_modules/**',
        '**/venv/**',
        '**/env/**',
        '**/.venv/**',
        '**/site-packages/**',
        '**/__pycache__/**',
        '**/tests/**',
        '**/*_test.py',
        '**/test_*.py',
        ...config.exclude || []
    ].join(',');
    
    const pythonFiles = await vscode.workspace.findFiles('**/*.py', `{${excludePatterns}}`);
    
    // console.log(`[VERTEX] Found ${pythonFiles.length} Python files after exclusions`);
    
    // Safety check: Limit file count to prevent timeouts
    const MAX_FILES = 500;
    if (pythonFiles.length > MAX_FILES) {
        vscode.window.showWarningMessage(
            `VERTEX: Found ${pythonFiles.length} Python files. Limiting to ${MAX_FILES} for performance. ` +
            `Consider adding more exclusion patterns in settings.`
        );
        pythonFiles.splice(MAX_FILES);
    }
    
    for (const file of pythonFiles) {
        try {
            const content = await vscode.workspace.fs.readFile(file);
            // Use fsPath for proper path handling on Windows
            files[file.fsPath] = content.toString();
            // console.log(`[VERTEX] Read file: ${file.fsPath}`);
        } catch (error) {
            // console.warn(`[VERTEX] Failed to read file ${file.fsPath}:`, error);
        }
    }
    
    return files;
}

/**
 * Build project context for multi-file analysis
 */
export async function buildProjectContext(files: Record<string, string>): Promise<any> {
    const filePaths = Object.keys(files);
    // console.log(`[VERTEX] Building project context for ${filePaths.length} files`);
    
    // Build import map and symbol table by parsing files
    const importMap: Record<string, string> = {};
    const symbolTable: Record<string, any[]> = {};
    const packageMap: Record<string, any> = {};

    // For each file, parse it to build import map and symbol table
    for (const [filePath, content] of Object.entries(files)) {
        try {
            // console.log(`[VERTEX] Processing file: ${filePath}`);
            // Extract module name from file path (simplified)
            const fileName = path.basename(filePath);
            const moduleName = fileName.replace(/\.py$/, '');
            
            if (moduleName) {
                importMap[moduleName] = filePath;
                // console.log(`[VERTEX] Added import mapping: ${moduleName} -> ${filePath}`);
            }
            
            // Extract function names and their line numbers
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                // Match function definitions
                const funcMatch = line.match(/^\s*def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/);
                if (funcMatch) {
                    const functionName = funcMatch[1];
                    if (!symbolTable[functionName]) {
                        symbolTable[functionName] = [];
                    }
                    symbolTable[functionName].push({
                        file_path: filePath,
                        line: i + 1, // 1-based line numbers
                        name: functionName
                    });
                    // console.log(`[VERTEX] Found function ${functionName} at line ${i + 1} in ${filePath}`);
                }
            }
        } catch (error) {
            // console.warn(`[VERTEX] Failed to parse file ${filePath} for project context:`, error);
        }
    }

    // Build project context
    const context: any = {
        project_root: vscode.workspace.rootPath || '',
        file_paths: filePaths,
        import_map: importMap,
        symbol_table: symbolTable,
        package_map: packageMap,
    };

    // console.log(`[VERTEX] Project context built with ${Object.keys(importMap).length} imports and ${Object.keys(symbolTable).length} symbols`);
    return context;
}