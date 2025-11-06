import * as vscode from 'vscode';
import { backendClient } from '../api/backendClient';
import { getConfig } from '../config';
import { collectProjectFiles, buildProjectContext } from '../utils/projectAnalysisUtils';

const deadCodeDiagnosticCollection = vscode.languages.createDiagnosticCollection('vertex');

export async function updateDeadCodeDiagnostics(editor: vscode.TextEditor | undefined) {
    await updateProjectWideDeadCodeDiagnostics();
}

export async function runInitialDeadCodeAnalysis(): Promise<void> {
    const config = getConfig();
    if (!config.showUnusedWarnings) {
        return;
    }

    // Only run if we have a workspace open
    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
        return;
    }

    // Show a less intrusive notification for initial analysis
    vscode.window.showInformationMessage('VERTEX: Running initial dead code analysis...');
    
    try {
        await updateProjectWideDeadCodeDiagnostics();
    } catch (error) {
        console.error('[VERTEX] Initial dead code analysis failed:', error);
    }
}

// export async function updateProjectWideDeadCodeDiagnostics(): Promise<void> {
async function updateProjectWideDeadCodeDiagnostics(): Promise<void> {
    const config = getConfig();
    if (!config.showUnusedWarnings) {
        deadCodeDiagnosticCollection.clear();
        return;
    }

    try {
        // Show progress for large projects
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "VERTEX: Analyzing project for dead code...",
            cancellable: false
        }, async (progress) => {
            progress.report({ increment: 0, message: "Collecting files..." });

            const projectFiles = await collectProjectFiles();
            // console.log(`[VERTEX] Collected ${Object.keys(projectFiles).length} project files`);

            progress.report({ increment: 50, message: "Building project context..." });
            if (Object.keys(projectFiles).length === 0) {
                deadCodeDiagnosticCollection.clear();
                return;
            }

            const projectContext = await buildProjectContext(projectFiles);
            // console.log(`[VERTEX] Built project context with ${Object.keys(projectContext.symbol_table || {}).length} symbols`);

            // Collect dead functions from all files in the project
            const allDeadFunctions: any[] = [];

            // Analyze each file in the project with multi-file context
            for (const targetFile of Object.keys(projectFiles)) {
                // console.log(`[VERTEX] Analyzing file for dead code: ${targetFile}`);

                try {
                    // Get dead code report for this specific file with full project context
                    const report = await backendClient.getDeadCodeFromProject(
                        projectFiles,
                        projectContext,
                        targetFile
                    );

                    // Add dead functions from this file to our collection
                    allDeadFunctions.push(...report.dead_functions);
                    // console.log(`[VERTEX] Found ${report.dead_functions.length} dead functions in ${targetFile}`);
                } catch (error) {
                    console.error(`[VERTEX] Failed to analyze dead code for ${targetFile}:`, error);
                }
            }

            // console.log(`[VERTEX] Total dead functions found across project: ${allDeadFunctions.length}`);

            // Clear all diagnostics first
            deadCodeDiagnosticCollection.clear();

            // Group dead functions by file for proper diagnostics placement
            const diagnosticsByFile: Map<string, vscode.Diagnostic[]> = new Map();

            for (const deadFunc of allDeadFunctions) {
                console.log(`[VERTEX] Processing dead function: ${deadFunc.name} at line ${deadFunc.line}`);
                // Find which file this dead function is defined in
                let functionFileUri: string | undefined;

                // First, try to find it in the symbol table from project context
                const symbolTable = projectContext.symbol_table || {};
                const functionSymbols = symbolTable[deadFunc.name] || [];
                console.log(`[VERTEX] Found ${functionSymbols.length} symbols for ${deadFunc.name}`);

                // Look for exact line match
                for (const symbol of functionSymbols) {
                    if (symbol.line === deadFunc.line && symbol.file_path) {
                        functionFileUri = symbol.file_path;
                        console.log(`[VERTEX] Found exact match for ${deadFunc.name} in ${functionFileUri}`);
                        break;
                    }
                }

                // If not found in symbol table, try content-based matching
                if (!functionFileUri) {
                    console.log(`[VERTEX] No exact symbol match, trying content-based matching`);
                    for (const [fileUri, content] of Object.entries(projectFiles)) {
                        const lines = content.split('\n');
                        if (deadFunc.line <= lines.length) {
                            const line = lines[deadFunc.line - 1]; // Convert to 0-based
                            if (line && line.includes(`def ${deadFunc.name}`)) {
                                functionFileUri = fileUri;
                                console.log(`[VERTEX] Found content match for ${deadFunc.name} in ${functionFileUri}`);
                                break;
                            }
                        }
                    }
                }
                if (!functionFileUri) {
                    console.warn(`[VERTEX] Could not locate file for dead function ${deadFunc.name} at line ${deadFunc.line}`);
                    continue;
                }
                const lineIndex = deadFunc.line - 1; // Convert to 0-based
                let range: vscode.Range;

                try {
                    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(functionFileUri));
                    if (lineIndex < doc.lineCount) {
                        range = new vscode.Range(
                            new vscode.Position(lineIndex, 0),
                            new vscode.Position(lineIndex, doc.lineAt(lineIndex).text.length)
                        );
                    } else {
                        range = new vscode.Range(
                            new vscode.Position(lineIndex, 0),
                            new vscode.Position(lineIndex, 100) // Fallback length
                        );
                    }
                } catch {
                    range = new vscode.Range(
                        new vscode.Position(lineIndex, 0),
                        new vscode.Position(lineIndex, 100) // Default length
                    );
                }

                const diagnostic = new vscode.Diagnostic(
                    range,
                    deadFunc.message,
                    vscode.DiagnosticSeverity.Warning
                );

                diagnostic.code = 'vertex.unused-function';
                diagnostic.source = 'VERTEX';

                // Group diagnostics by file
                if (!diagnosticsByFile.has(functionFileUri)) {
                    diagnosticsByFile.set(functionFileUri, []);
                }
                diagnosticsByFile.get(functionFileUri)!.push(diagnostic);
            }

            // Apply diagnostics to all files that have dead code
            for (const [fileUri, diagnostics] of diagnosticsByFile.entries()) {
                console.log(`[VERTEX] Applying ${diagnostics.length} diagnostics to ${fileUri}`);
                // Use vscode.Uri.file for proper file path handling on Windows
                deadCodeDiagnosticCollection.set(vscode.Uri.file(fileUri), diagnostics);
            }

            console.log(`[VERTEX] Project-wide dead code analysis: ${allDeadFunctions.length} unused functions across ${diagnosticsByFile.size} files`);
            if (allDeadFunctions.length > 0) {
                vscode.window.showInformationMessage(
                    `VERTEX found ${allDeadFunctions.length} unused functions across ${diagnosticsByFile.size} files`
                );
            }
        });
    } catch (error) {
        console.error('[VERTEX] Project-wide dead code analysis failed:', error);
        deadCodeDiagnosticCollection.clear();
    }
}

export function dispose() {
    deadCodeDiagnosticCollection.dispose();
}