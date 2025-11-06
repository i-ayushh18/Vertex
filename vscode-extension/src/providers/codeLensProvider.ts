import * as vscode from 'vscode';
import { backendClient } from '../api/backendClient';
import { getConfig } from '../config';
import { collectProjectFiles, buildProjectContext } from '../utils/projectAnalysisUtils';

export class VERTEXCodeLensProvider implements vscode.CodeLensProvider {
  private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

  constructor() {
    // Listen for configuration changes to refresh CodeLenses
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('vertex')) {
        this._onDidChangeCodeLenses.fire();
      }
    });
  }

  public async provideCodeLenses(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): Promise<vscode.CodeLens[]> {
    if (document.languageId !== 'python') return [];

    const config = getConfig();
    if (!config.showCodeLens) return [];

    try {
      const code = document.getText();
      if (!code || code.trim().length === 0) {
        return [];
      }

      // Collect project files for multi-file analysis
      const projectFiles = await collectProjectFiles();
      // console.log('[VERTEX] Found project files:', Object.keys(projectFiles).length);

      // Limit the number of files for performance (avoid timeout on large projects)
      const MAX_FILES_FOR_ANALYSIS = 100;
      const fileCount = Object.keys(projectFiles).length;

      if (fileCount > MAX_FILES_FOR_ANALYSIS) {
        // console.log(`[VERTEX] Too many files (${fileCount}) for analysis, falling back to single-file analysis`);
        vscode.window.showWarningMessage(`VERTEX: Project too large (${fileCount} files). Using single-file analysis for performance.`);

        // Single file analysis (fallback for large projects)
        const result = await backendClient.getCodeLens(code);
        if (!result || !result.items || result.items.length === 0) {
          // console.log('[VERTEX] No CodeLens items returned from single-file analysis');
          return [];
        }

        // console.log('[VERTEX] Single-file CodeLens items:', result.items);
        return this.createCodeLenses(document, result.items);
      }

      // Use multi-file analysis if we have project files (even if just 1, as long as we're in a project)
      if (Object.keys(projectFiles).length > 0) {
        // console.log('[VERTEX] Using multi-file analysis for CodeLens');
        // Multi-file analysis
        const projectContext = await buildProjectContext(projectFiles);
        // console.log('[VERTEX] Project context built');

        // Use the document's file path as target file (not URI)
        const targetFile = document.fileName;
        // console.log('[VERTEX] Target file:', targetFile);

        // Make sure the target file exists in projectFiles
        if (!projectFiles[targetFile]) {
          // console.log('[VERTEX] Target file not found in project files, adding it');
          projectFiles[targetFile] = code;
        }

        try {
          const result = await backendClient.getCodeLensFromProject(
            projectFiles,
            projectContext,
            targetFile
          );

          if (!result || !result.items || result.items.length === 0) {
            console.log('[VERTEX] No CodeLens items returned from multi-file analysis');
            return [];
          }

          console.log('[VERTEX] Multi-file CodeLens items:', result.items);
          return this.createCodeLenses(document, result.items);
        } catch (error) {
          console.error('[VERTEX] Multi-file analysis failed, falling back to single-file analysis:', error);
          // Fallback to single-file analysis if multi-file fails
          const result = await backendClient.getCodeLens(code);
          if (!result || !result.items || result.items.length === 0) {
            console.log('[VERTEX] No CodeLens items returned from single-file analysis fallback');
            return [];
          }

          console.log('[VERTEX] Single-file CodeLens items (fallback):', result.items);
          return this.createCodeLenses(document, result.items);
        }
      } else {
        console.log('[VERTEX] Using single-file analysis for CodeLens (fallback)');
        // Single file analysis (fallback)
        const result = await backendClient.getCodeLens(code);
        if (!result || !result.items || result.items.length === 0) {
          console.log('[VERTEX] No CodeLens items returned from single-file analysis');
          return [];
        }

        console.log('[VERTEX] Single-file CodeLens items:', result.items);
        return this.createCodeLenses(document, result.items);
      }
    } catch (error) {
      console.error('[VERTEX] Error in provideCodeLenses:', error);
      if (error instanceof Error) {
        vscode.window.showErrorMessage(`VERTEX: ${error.message}`);
      }
      return [];
    }
  }

  private createCodeLenses(document: vscode.TextDocument, items: any[]): vscode.CodeLens[] {
    const lenses: vscode.CodeLens[] = [];

    for (const item of items) {
      const line0 = item.line - 1; // Convert to 0-based
      if (line0 < 0 || line0 >= document.lineCount) continue;

      const range = document.lineAt(line0).range;

      // IMPORTANT: lock mode (callers + callees), pass function context
      lenses.push(
        new vscode.CodeLens(range, {
          title: item.title,
          command: 'vertex.lockFunctionHighlights',
          arguments: [item.name, { line: item.line, end_line: item.end_line }],
          tooltip: item.tooltip,
        })
      );
    }

    return lenses;
  }

  public resolveCodeLens(
    codeLens: vscode.CodeLens,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.CodeLens> {
    return codeLens;
  }

  public refresh(): void {
    this._onDidChangeCodeLenses.fire();
  }
}

// export const codeLensProvider = new VERTEXCodeLensProvider();