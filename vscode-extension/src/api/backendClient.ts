import { getConfig } from '../config';

export interface AnalysisResult {
    functions: FunctionInfo[];
    calls: CallInfo[];
    callers_by_func: { [key: string]: number[] };
    metadata: {
        function_count: number;
        call_count: number;
    };
}

export interface FunctionInfo {
    name: string;
    line: number;
    end_line: number;
}

export interface CallInfo {
    name: string;
    line: number;
    column?: number;
}

export interface NavigationResult {
    line: number | null;
    column?: number;
    index: number;
    total: number;
    function_name: string;
    caller_lines: number[];
    message: string;
}

export interface HighlightResult {
    callers: HighlightInfo[];
    callees: HighlightInfo[];
    total_callers: number;
    total_callees: number;
}

export interface HighlightInfo {
    line: number;
    type: string;
    function_name?: string;
    range: {
        line: number;
        start_column: number;
        end_column: number;
    };
}

export interface DeadCodeReport {
    dead_functions: DeadFunction[];
    total_unused: number;
    total_functions: number;
}

export interface DeadFunction {
    name: string;
    line: number;
    end_line: number;
    message: string;
}

export interface CodeLensItem {
    name: string;
    line: number;
    end_line: number;
    caller_count: number;
    callee_count: number;
    title: string;
    tooltip: string;
}

export class BackendClient {
    private baseUrl: string;

    constructor() {
        this.baseUrl = getConfig().backendUrl;
    }

    private async request<T>(endpoint: string, body: any): Promise<T> {
        try {
            // console.log(`[VERTEX] Making request to ${endpoint}`, { endpoint, body });
            
            // Determine timeout based on request type
            let timeoutMs = 15000; // Default 15 seconds
            if (endpoint === '/deadcode' || endpoint === '/codelens' || endpoint === '/analyze-project') {
                timeoutMs = 90000; // 90 seconds for project analysis
                // console.log(`[VERTEX] Using ${timeoutMs/1000}s timeout for project analysis`);
            }
            
            const response = await fetch(`${this.baseUrl}${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(timeoutMs)
            });
            // console.log(`[VERTEX] Received response from ${endpoint}`, { status: response.status, ok: response.ok });

            if (!response.ok) {
    let errorDetail = 'Backend request failed';
    try {
        const errorData: any = await response.json();
        // console.log(`[VERTEX] Backend error response for ${endpoint}:`, errorData);
        
        // Extract meaningful error information
                    if (errorData.detail) {
                        // Ensure it's a string
                        errorDetail = typeof errorData.detail === 'string'
                            ? errorData.detail
                            : JSON.stringify(errorData.detail);
                    } else if (errorData.message) {
                        // Ensure it's a string
                        errorDetail = typeof errorData.message === 'string'
                            ? errorData.message
                            : JSON.stringify(errorData.message);
                    } else if (Array.isArray(errorData) && errorData.length > 0) {
                        const firstError = errorData[0];
                        if (firstError.msg) {
                            errorDetail = typeof firstError.msg === 'string'
                                ? firstError.msg
                                : JSON.stringify(firstError.msg);
                        } else {
                            errorDetail = `HTTP ${response.status}: ${response.statusText}`;
                        }
                    } else if (typeof errorData === 'object') {
                        // If we have an object with no recognized fields
                        errorDetail = JSON.stringify(errorData);
                    } else if (typeof errorData === 'string') {
                        // If the entire response is just a string
                        errorDetail = errorData;
                    } else {
                        errorDetail = `HTTP ${response.status}: ${response.statusText}`;
                    }
                } catch (e) {
                    // console.log(`[VERTEX] Failed to parse error JSON for ${endpoint}:`, e);
                    errorDetail = `HTTP ${response.status}: ${response.statusText}`;
                }

                // console.log(`[VERTEX] Throwing error for ${endpoint}:`, errorDetail);
                throw new Error(errorDetail);  // Now errorDetail is guaranteed to be a string
            }

            const result = await response.json() as T;
            // console.log(`[VERTEX] Successful response from ${endpoint}:`, result);
            return result;
        } catch (error: unknown) {
            // console.error(`Backend request failed [${endpoint}]:`, error);
            // console.error(`Backend request failed [${endpoint}], error type:`, typeof error);
            // Better error handling for different types of errors
            if (error instanceof Error) {
                // console.error(`[VERTEX] Error instance for ${endpoint}:`, error.message);
                throw error; // Re-throw the clean error
            } else if (typeof error === 'string') {
                // console.error(`[VERTEX] String error for ${endpoint}:`, error);
                throw new Error(error);
            } else if (error === null) {
                // console.error(`[VERTEX] Null error for ${endpoint}`);
                throw new Error('null');
            } else if (error === undefined) {
                // console.error(`[VERTEX] Undefined error for ${endpoint}`);
                throw new Error('undefined');
            } else if (error && typeof error === 'object') {
                // Try to extract meaningful information from object errors
                if ('message' in error && typeof error.message === 'string') {
                    // console.error(`[VERTEX] Object error with message for ${endpoint}:`, error.message);
                    throw new Error(error.message);
                } else if ('detail' in error && typeof error.detail === 'string') {
                    // console.error(`[VERTEX] Object error with detail for ${endpoint}:`, error.detail);
                    throw new Error(error.detail);
                } else {
                    try {
                        const errorString = safeStringify(error, 2);
                        // console.log(`[VERTEX] Unknown error object for ${endpoint}:`, errorString);
                        throw new Error(`An unknown error occurred during the request: ${errorString}`);
                    } catch (stringifyError) {
                        // Fallback to a more descriptive string representation
                        try {
                            const errorString = Object.prototype.toString.call(error);
                            // console.log(`[VERTEX] Failed to stringify error object for ${endpoint}:`, errorString);
                            throw new Error(`An unknown error occurred during the request: ${errorString}`);
                        } catch (toStringError) {
                            // console.log(`[VERTEX] Failed to convert error object to string for ${endpoint}:`, error);
                            throw new Error(`An unknown error occurred during the request: ${String(error)}`);
                        }
                    }
                }
            } else {
                // console.error(`[VERTEX] Unknown error type for ${endpoint}:`, String(error));
                throw new Error(`An unknown error occurred during the request: ${String(error)}`);
            }
        }
    }

    async analyze(code: string, fileId?: string): Promise<AnalysisResult> {
        return this.request<AnalysisResult>('/analyze', { code, file_id: fileId });
    }

    async analyzeProject(
        files: Record<string, string>,
        projectContext: any,
        targetFile: string
    ): Promise<AnalysisResult> {
        return this.request<AnalysisResult>('/analyze-project', {
            files,
            project_context: projectContext,
            target_file: targetFile
        });
    }

    async navigate(
        code: string,
        fileId: string,
        functionName: string,
        currentIndex: number,
        direction: 'first' | 'next' | 'prev'
    ): Promise<NavigationResult> {
        return this.request<NavigationResult>('/navigate', {
            code,
            file_id: fileId,
            function_name: functionName,
            current_index: currentIndex,
            direction,
        });
    }

    async getHighlights(
        code: string,
        functionName: string,
        functionContext?: { line: number; end_line: number }
    ): Promise<HighlightResult> {
        return this.request<HighlightResult>('/highlight', {
            code,
            function_name: functionName,
            function_context: functionContext,
        });
    }

    async getHighlightsFromProject(
        files: Record<string, string>,
        projectContext: any,
        targetFile: string,
        functionName: string,
        functionContext?: { line: number; end_line: number }
    ): Promise<HighlightResult> {
        return this.request<HighlightResult>('/extract-highlights', {
            files,
            project_context: projectContext,
            target_file: targetFile,
            function_name: functionName,
            function_context: functionContext,
        });
    }

    async getDeadCode(code: string): Promise<DeadCodeReport> {
        return this.request<DeadCodeReport>('/deadcode', { code });
    }
    async getDeadCodeFromProject(
        files: Record<string, string>,
        projectContext: any,
        targetFile: string
    ): Promise<DeadCodeReport> {
        const code = files[targetFile];
        if (!code) {
            throw new Error(`Target file ${targetFile} not found in project files`);
        }
        // console.log(`[VERTEX] Calling deadcode endpoint with project context`);
        // console.log(`[VERTEX] Target file: ${targetFile}`);
        // console.log(`[VERTEX] Files count: ${Object.keys(files).length}`);
        // console.log(`[VERTEX] Project context symbols: ${Object.keys(projectContext.symbol_table || {}).length}`);
        
        const result = await this.request<DeadCodeReport>('/deadcode', {
            code,
            files,
            project_context: projectContext,
            target_file: targetFile,
        });
        
        // console.log(`[VERTEX] Dead code report received: ${result.dead_functions.length} dead functions`);
        return result;
    }

    async getCodeLens(code: string): Promise<{ items: CodeLensItem[]; total_items: number }> {
        return this.request<{ items: CodeLensItem[]; total_items: number }>('/codelens', { code });
    }

    async getCodeLensFromProject(
        files: Record<string, string>,
        projectContext: any,
        targetFile: string
    ): Promise<{ items: CodeLensItem[]; total_items: number }> {
        const code = files[targetFile];
        return this.request<{ items: CodeLensItem[]; total_items: number }>('/codelens', {
            code:code,
            files,
            project_context: projectContext,
            target_file: targetFile
        });
    }

    async clearSession(fileId: string): Promise<void> {
        await fetch(`${this.baseUrl}/session/${encodeURIComponent(fileId)}`, {
            method: 'DELETE',
        });
    }

    async checkHealth(): Promise<{ status: string }> {
        const response = await fetch(`${this.baseUrl}/health`);
        return response.json() as Promise<{ status: string }>;
    }
}

export const backendClient = new BackendClient();

function safeStringify(obj: any, space: number = 2): string {
    const seen = new WeakSet();
    
    return JSON.stringify(obj, (key, value) => {
        if (typeof value === "object" && value !== null) {
            if (seen.has(value)) {
                return "[Circular Reference]";
            }
            seen.add(value);
        }
        return value;
    }, space);
}
