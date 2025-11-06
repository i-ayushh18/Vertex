import * as vscode from 'vscode';

export interface VertexConfig {
    backendUrl: string;
    showCallerHighlights: boolean;
    showCalleeHighlights: boolean;
    showCodeLens: boolean;
    showUnusedWarnings: boolean;
    exclude: string[];
}

export function getConfig(): VertexConfig {
    const config = vscode.workspace.getConfiguration('vertex');
    return {
        backendUrl: config.get('backendUrl', 'http://localhost:8000'),
        showCallerHighlights: config.get('showCallerHighlights', true),
        showCalleeHighlights: config.get('showCalleeHighlights', true),
        showCodeLens: config.get('showCodeLens', true),
        showUnusedWarnings: config.get('showUnusedWarnings', true),
        exclude: config.get('exclude', [
            '**/tests/**',
            '**/*_test.py',
            '**/test_*.py',
            '**/__pycache__/**',
            '**/venv/**',
            '**/env/**'
        ]),
    };
}