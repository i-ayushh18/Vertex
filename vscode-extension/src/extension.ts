import * as vscode from 'vscode';
import { backendClient } from './api/backendClient';
import {
  updateCallerHighlights,
  disposeDecorations,
  lockFunctionHighlights,
  lockFunctionByName,
  unlockFunctionHighlights,
  registerLockModeEventHandlers,
  nextLockedCaller,
  prevLockedCaller
} from './providers/highlightProvider';
import { VERTEXCodeLensProvider } from './providers/codeLensProvider';
import { updateDeadCodeDiagnostics, runInitialDeadCodeAnalysis, dispose as disposeDeadCodeProvider } from './providers/deadCodeProvider';
import { BackendManager } from './backendManager';

// Global backend manager instance
let backendManager: BackendManager | null = null;

export async function activate(context: vscode.ExtensionContext) {
  // console.log('VERTEX extension activated');

  // Initialize and start backend
  backendManager = new BackendManager(context.extensionPath);
  const backendStarted = await backendManager.startBackend();
  
  if (!backendStarted) {
    vscode.window.showErrorMessage(
      'VERTEX: Failed to start backend server. Some features may not work.',
      'Show Output'
    ).then(selection => {
      if (selection === 'Show Output') {
        vscode.commands.executeCommand('workbench.action.output.toggleOutput');
      }
    });
  } else {
    // Run initial dead code analysis when workspace is opened (only if backend started successfully)
    setTimeout(async () => {
      await runInitialDeadCodeAnalysis();
    }, 2000); // Wait 2 seconds to let everything settle
  }

  // ==================== Test Commands ====================
  const helloCommand = vscode.commands.registerCommand('vertex.hello', () => {
    vscode.window.showInformationMessage('Hello from VERTEX!');
  });

  const testBackendCommand = vscode.commands.registerCommand('vertex.testBackend', async () => {
    try {
      const health = await backendClient.checkHealth();
      if (health.status === 'ok') {
        vscode.window.showInformationMessage('Backend status: OK');
      } else {
        vscode.window.showWarningMessage('Backend responded but status is not OK');
      }
    } catch (error) {
      vscode.window.showErrorMessage('Failed to connect to backend. Is it running on port 8000?');
      console.error('Backend health check failed:', error);
    }
  });

  const analyzeBackendCommand = vscode.commands.registerCommand('vertex.analyzeBackend', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'python') {
      vscode.window.showWarningMessage('Please open a Python file first');
      return;
    }
    const code = editor.document.getText();
    try {
      const analysis = await backendClient.analyze(code, editor.document.uri.toString());
      vscode.window.showInformationMessage(
        `Found ${analysis.metadata.function_count} functions with ${analysis.metadata.call_count} calls`
      );
    } catch (error) {
      vscode.window.showErrorMessage(`Analysis failed: ${error}`);
      console.error('Analysis failed:', error);
    }
  });

  // Manual dead code analysis command
  const analyzeDeadCodeCommand = vscode.commands.registerCommand('vertex.analyzeDeadCode', async () => {
    // Check if we have a workspace open
    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
      vscode.window.showWarningMessage('VERTEX: Please open a workspace/folder to analyze dead code');
      return;
    }

    // Check if we have Python files in the workspace
    const pythonFiles = await vscode.workspace.findFiles('**/*.py');
    if (pythonFiles.length === 0) {
      vscode.window.showWarningMessage('VERTEX: No Python files found in workspace');
      return;
    }

    vscode.window.showInformationMessage('VERTEX: Starting dead code analysis...');
    await updateDeadCodeDiagnostics(undefined);
  });

  // ==================== CodeLens Provider ====================
  const codeLensProvider = new VERTEXCodeLensProvider();
  const codeLensDisposable = vscode.languages.registerCodeLensProvider(
    { language: 'python' },
    codeLensProvider
  );


  // ==================== Lock Mode Commands ====================
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'vertex.lockFunctionHighlights',
      async (name: string, ctx?: { line: number; end_line: number }) => {
        await lockFunctionHighlights(name, ctx);
      }
    ),
    vscode.commands.registerCommand('vertex.lockFunctionByName', async () => {
      const name = await vscode.window.showInputBox({ prompt: 'Function name to lock' });
      if (name) await lockFunctionByName(name);
    }),
    vscode.commands.registerCommand('vertex.unlockFunctionHighlights', async () => {
      await unlockFunctionHighlights();
    })
  );

  // ==================== Event Listeners ====================

  // Document change listener (removed dead code analysis for performance)
  const documentChangeListener = vscode.workspace.onDidChangeTextDocument(async (e) => {
    // Only refresh highlights if in lock mode, no dead code analysis on every keystroke
    const editor = vscode.window.activeTextEditor;
    if (editor && e.document === editor.document && editor.document.languageId === 'python') {
      // Dead code analysis removed - use manual command instead
    }
  });

  // Dead code analysis on active editor change (disabled for performance)
  // const activeEditorChangeListener = vscode.window.onDidChangeActiveTextEditor(async (editor) => {
  //   if (editor && editor.document.languageId === 'python') {
  //     await updateDeadCodeDiagnostics(editor);
  //   }
  // });

  // Register lock-mode event handlers (refresh highlights only while locked)
  registerLockModeEventHandlers(context);

  // ==================== Initial Update ====================
  if (vscode.window.activeTextEditor) {
    const editor = vscode.window.activeTextEditor;
    if (editor.document.languageId === 'python') {
      updateCallerHighlights(editor);      // clears decorations if not locked
      // Dead code analysis removed from initial load - use manual command instead
    }
  }

  // ==================== Status Bar Item ====================
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.text = '$(telescope) VERTEX';
  statusBarItem.tooltip = 'VERTEX: Click to test backend connection';
  statusBarItem.command = 'vertex.testBackend';
  statusBarItem.show();

  // ==================== Register All Disposables ====================
  context.subscriptions.push(
    helloCommand,
    testBackendCommand,
    analyzeBackendCommand,
    analyzeDeadCodeCommand,
    codeLensDisposable,
    documentChangeListener,
    // activeEditorChangeListener, // Disabled for performance
    statusBarItem
  );
  // Add these to your extension.ts after the lock mode commands
  context.subscriptions.push(
  vscode.commands.registerCommand('vertex.nextLockedCaller', nextLockedCaller),
  vscode.commands.registerCommand('vertex.prevLockedCaller', prevLockedCaller)
  );

  // console.log('VERTEX extension fully activated (lock mode ready)');
}

export function deactivate() {
  // console.log('VERTEX extension deactivating');
  
  // Stop backend server
  if (backendManager) {
    backendManager.dispose();
    backendManager = null;
  }
  
  disposeDeadCodeProvider();
  disposeDecorations();
}