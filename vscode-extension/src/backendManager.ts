import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, ChildProcess } from 'child_process';

export class BackendManager {
    private backendProcess: ChildProcess | null = null;
    private readonly backendPath: string;
    private readonly outputChannel: vscode.OutputChannel;

    constructor(extensionPath: string) {
        // Create output channel first so we can log everything
        this.outputChannel = vscode.window.createOutputChannel('VERTEX Backend');
        
        try {
            // Path to bundled backend executable
            const platform = process.platform;
            const execName = platform === 'win32' ? 'vertex-server.exe' : 'vertex-server';
            this.backendPath = path.join(extensionPath, 'backend', execName);
            
            this.outputChannel.appendLine(`[INIT] Extension path: ${extensionPath}`);
            this.outputChannel.appendLine(`[INIT] Platform: ${platform}`);
            this.outputChannel.appendLine(`[INIT] Backend path: ${this.backendPath}`);
        } catch (error) {
            this.outputChannel.appendLine(`[ERROR] Constructor failed: ${error}`);
            throw error;
        }
    }

    async startBackend(): Promise<boolean> {
        this.outputChannel.appendLine('[VERTEX] startBackend() called');
        this.outputChannel.appendLine(`[VERTEX] Backend path: ${this.backendPath}`);
        this.outputChannel.appendLine(`[VERTEX] Backend exists: ${fs.existsSync(this.backendPath)}`);
        
        if (this.backendProcess) {
            this.outputChannel.appendLine('[VERTEX] Backend already running');
            return true;
        }

        if (!fs.existsSync(this.backendPath)) {
            const msg = 'VERTEX: Backend executable not found. Please reinstall the extension.';
            this.outputChannel.appendLine(`[ERROR] ${msg}`);
            vscode.window.showErrorMessage(msg);
            return false;
        }

        try {
            this.outputChannel.appendLine(`[VERTEX] Spawning backend: ${this.backendPath}`);

            this.backendProcess = spawn(this.backendPath, [], {
                stdio: ['ignore', 'pipe', 'pipe'],
                detached: false,
                windowsHide: true
            });

            this.outputChannel.appendLine(`[VERTEX] Backend process spawned with PID: ${this.backendProcess.pid}`);

            // Handle backend output
            this.backendProcess.stdout?.on('data', (data) => {
                this.outputChannel.appendLine(`[STDOUT] ${data.toString().trim()}`);
            });

            this.backendProcess.stderr?.on('data', (data) => {
                this.outputChannel.appendLine(`[STDERR] ${data.toString().trim()}`);
            });

            // Handle backend errors
            this.backendProcess.on('error', (error) => {
                this.outputChannel.appendLine(`[ERROR] Backend process error: ${error.message}`);
            });

            // Handle backend exit
            this.backendProcess.on('exit', (code, signal) => {
                this.outputChannel.appendLine(`[VERTEX] Backend exited with code: ${code}, signal: ${signal}`);
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

            // Wait and retry connection test
            this.outputChannel.appendLine('[VERTEX] Waiting for backend to start...');
            const maxRetries = 10;
            const retryDelay = 1000;
            
            for (let i = 0; i < maxRetries; i++) {
                await new Promise(resolve => setTimeout(resolve, retryDelay));
                this.outputChannel.appendLine(`[VERTEX] Connection attempt ${i + 1}/${maxRetries}...`);
                
                const isRunning = await this.testBackendConnection();
                if (isRunning) {
                    this.outputChannel.appendLine('[VERTEX] ✅ Backend started successfully!');
                    vscode.window.showInformationMessage('VERTEX: Backend started successfully');
                    return true;
                }
            }

            this.outputChannel.appendLine('[VERTEX] ❌ Backend failed to respond after all retries');
            this.outputChannel.show();
            this.stopBackend();
            return false;

        } catch (error) {
            const errorMsg = `Failed to start backend: ${error}`;
            this.outputChannel.appendLine(`[ERROR] ${errorMsg}`);
            this.outputChannel.show();
            vscode.window.showErrorMessage(`VERTEX: ${errorMsg}`);
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
