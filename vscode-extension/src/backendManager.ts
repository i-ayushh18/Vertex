import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, ChildProcess } from 'child_process';

export class BackendManager {
    private backendProcess: ChildProcess | null = null;
    private readonly backendPath: string;
    private readonly outputChannel: vscode.OutputChannel;

    constructor(extensionPath: string) {
        // Path to bundled backend executable
        const platform = process.platform;
        const execName = platform === 'win32' ? 'vertex-server.exe' : 'vertex-server';
        this.backendPath = path.join(extensionPath, 'backend', execName);

        this.outputChannel = vscode.window.createOutputChannel('VERTEX Backend');
    }

    async startBackend(): Promise<boolean> {
        // console.log('[VERTEX] startBackend() called');
        // console.log('[VERTEX] Extension path:', this.backendPath);
        // console.log('[VERTEX] Backend exists:', fs.existsSync(this.backendPath));
        if (this.backendProcess) {
            // console.log('[VERTEX] Backend already running');
            return true;
        }

        if (!fs.existsSync(this.backendPath)) {
            vscode.window.showErrorMessage(
                'VERTEX: Backend executable not found. Please reinstall the extension.'
            );
            return false;
        }

        try {
            // console.log(`[VERTEX] Starting backend: ${this.backendPath}`);

            this.backendProcess = spawn(this.backendPath, [], {
                stdio: ['ignore', 'pipe', 'pipe'],
                detached: false
            });

            // Handle backend output
            this.backendProcess.stdout?.on('data', (data) => {
                this.outputChannel.appendLine(`[STDOUT] ${data.toString()}`);
            });

            this.backendProcess.stderr?.on('data', (data) => {
                this.outputChannel.appendLine(`[STDERR] ${data.toString()}`);
            });

            // Handle backend exit
            this.backendProcess.on('exit', (code) => {
                // console.log(`[VERTEX] Backend exited with code: ${code}`);
                this.backendProcess = null;

                if (code !== 0 && code !== null) {
                    vscode.window.showErrorMessage(
                        `VERTEX Backend crashed (exit code: ${code}). Check output for details.`,
                        'Show Output'
                    ).then(selection => {
                        if (selection === 'Show Output') {
                            this.outputChannel.show();
                        }
                    });
                }
            });

            // Wait a moment for startup
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Test if backend is responding
            const isRunning = await this.testBackendConnection();
            if (isRunning) {
                // console.log('[VERTEX] Backend started successfully');
                vscode.window.showInformationMessage('VERTEX: Backend started successfully');
                return true;
            } else {
                // console.log('[VERTEX] Backend failed to start properly');
                this.stopBackend();
                return false;
            }

        } catch (error) {
            console.error('[VERTEX] Failed to start backend:', error);
            vscode.window.showErrorMessage(`VERTEX: Failed to start backend: ${error}`);
            return false;
        }
    }

    stopBackend(): void {
        if (this.backendProcess) {
            // console.log('[VERTEX] Stopping backend...');
            this.backendProcess.kill();
            this.backendProcess = null;
        }
    }

    private async testBackendConnection(): Promise<boolean> {
        try {
            const response = await fetch('http://localhost:8000/health', {
                signal: AbortSignal.timeout(5000)
            });
            return response.ok;
        } catch {
            return false;
        }
    }

    isRunning(): boolean {
        return this.backendProcess !== null;
    }

    dispose(): void {
        this.stopBackend();
        this.outputChannel.dispose();
    }
}
