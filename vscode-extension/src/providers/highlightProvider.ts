import * as vscode from 'vscode';
import * as fs from 'fs';
import { backendClient } from '../api/backendClient';
import { getConfig } from '../config';
import { collectProjectFiles, buildProjectContext } from '../utils/projectAnalysisUtils';

interface PackageInfo {
    path: string;
    hasInit: boolean;
    submodules: string[];
    lastModified?: number;
}

interface SymbolInfo {
    file_path: string;
    line: number;
    name: string;
    isMethod?: boolean;
    class_name?: string;
}

interface ImportInfo {
    type: string;
    module: string;
    import?: string;
    alias?: string;
    line: number;
    column?: number;
}

interface ProjectContext {
    project_root: string;
    file_paths: string[];
    import_map: Record<string, string>;
    symbol_table: Record<string, SymbolInfo[]>;
    package_map: Record<string, PackageInfo>;
    last_updated?: number;
}

interface ClassInfo {
    name: string;
    methods: Array<{ name: string, line: number }>;
    start_line: number;
    end_line: number;
}

interface FuncContext {
    line: number;
    end_line: number;
    class_name?: string;
}

interface LockedState {
    name: string;
    context?: FuncContext;
    file?: string;
}

interface CallerOccurrence {
    line: number;
    column: number;
    file_path?: string;
}

interface HighlightInfo {
    line: number;
    type: string;  // "caller" or "callee"
    function_name?: string;
    range: {
        line: number;
        start_column: number;
        end_column: number;
    };
    file_path?: string;
}

// ========== DECORATIONS ==========
const callerDecorationType = vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgba(255,165,0,0.7)', // More opaque orange background
    border: '2px solid darkorange',
    borderRadius: '3px',
    overviewRulerLane: vscode.OverviewRulerLane.Right,
    overviewRulerColor: 'darkorange',
    light: {
        backgroundColor: 'rgba(255,140,0,0.6)', // Better visibility in light themes
        border: '2px solid orange'
    }
});

const calleeDecorationType = vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgba(255,182,193,0.8)', // Increased opacity for better visibility
    border: '2px dashed deeppink',
    borderRadius: '3px',
    overviewRulerLane: vscode.OverviewRulerLane.Left,
    overviewRulerColor: 'deeppink',
    light: {
        backgroundColor: 'rgba(255,192,203,0.7)', // Increased opacity for better visibility in light themes
        border: '2px dashed hotpink'
    }
});

const temporaryHighlightDecorationType = vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgba(255,165,0,0.9)', // Even more opaque temporary highlight
    border: '3px solid orange', // Thicker border
    borderRadius: '4px',
    outline: '2px solid rgba(255,165,0,1.0)', // Additional outline for better visibility
});

// ========== STATE MANAGEMENT ==========
let locked: LockedState | null = null;
let lockedCallerOccurrences: CallerOccurrence[] = [];
let lockedCallerIndex = -1;
let isNavigating = false; // Track when navigation commands are executing
// Store decorations for each editor to maintain persistence
const editorDecorations = new Map<string, { callers: vscode.DecorationOptions[], callees: vscode.DecorationOptions[] }>();

// ========== UTILITY FUNCTIONS ==========
function clearDecorations(editor: vscode.TextEditor) {
    editor.setDecorations(callerDecorationType, []);
    editor.setDecorations(calleeDecorationType, []);
    editor.setDecorations(temporaryHighlightDecorationType, []);
    // Clear stored decorations for this editor
    editorDecorations.delete(editor.document.uri.toString());
}

export function isLocked(): boolean {
    return locked !== null;
}

function getIndentLevel(line: string): number {
    const match = line.match(/^\s*/);
    return match ? match[0].length : 0;
}

// ========== IMPORT RESOLVER CLASS ==========
class ImportResolver {
    private readonly workspaceRoot: string;
    private readonly packageMap: Record<string, PackageInfo>;
    private importStack: Set<string> = new Set();
    private readonly maxDepth = 10;

    constructor(workspaceRoot: string, packageMap: Record<string, PackageInfo>) {
        this.workspaceRoot = workspaceRoot;
        this.packageMap = packageMap;
    }

    resolveRelativeImport(currentPath: string, relativeImport: string, depth = 0): string | undefined {
        if (depth > this.maxDepth) {
            // console.warn('Max import resolution depth exceeded');
            return undefined;
        }

        try {
            const dotCount = relativeImport.match(/^\.+/)?.[0].length || 0;
            const pathParts = currentPath.split('/');

            if (dotCount > pathParts.length) {
                // console.warn(`Invalid relative import: too many dots for path ${currentPath}`);
                return undefined;
            }

            pathParts.splice(-dotCount);
            const importPath = relativeImport.replace(/^\.+/, '');
            const resolvedPath = pathParts.join('/') + '/' + importPath;

            return this.findModuleFile(resolvedPath);
        } catch (error) {
            // console.warn(`Failed to resolve relative import ${relativeImport} from ${currentPath}:`, error);
            return undefined;
        }
    }

    resolveAbsoluteImport(importPath: string, depth = 0): string | undefined {
        if (depth > this.maxDepth) {
            // console.warn('Max import resolution depth exceeded');
            return undefined;
        }

        try {
            if (this.importStack.has(importPath)) {
                // console.warn(`Circular import detected: ${importPath}`);
                return undefined;
            }

            this.importStack.add(importPath);

            try {
                const packageName = importPath.split('.')[0];
                const pkg = this.packageMap[packageName];

                if (pkg) {
                    if (pkg.submodules.includes(importPath)) {
                        const modulePath = this.findModuleFile(pkg.path + '/' + importPath.replace(/\./g, '/'));
                        if (modulePath) return modulePath;
                    }

                    if (pkg.hasInit) {
                        const initPath = this.findModuleFile(pkg.path + '/__init__.py');
                        if (initPath) return initPath;
                    }
                }

                return this.findModuleFile(this.workspaceRoot + '/' + importPath.replace(/\./g, '/'));
            } finally {
                this.importStack.delete(importPath);
            }
        } catch (error) {
            // console.warn(`Failed to resolve absolute import ${importPath}:`, error);
            return undefined;
        }
    }

    private findModuleFile(basePath: string): string | undefined {
        try {
            const pyFile = basePath + '.py';
            if (fs.existsSync(pyFile)) {
                return pyFile;
            }

            const initFile = basePath + '/__init__.py';
            if (fs.existsSync(initFile)) {
                return initFile;
            }

            return undefined;
        } catch (error) {
            // console.warn(`Failed to check file existence: ${basePath}`, error);
            return undefined;
        }
    }
}

// ========== CORE FUNCTIONS ==========

// Enhanced function and class extraction
function extractFunctionsAndClasses(content: string): {
    functions: Array<{ name: string, line: number }>;
    classes: ClassInfo[];
} {
    const functions: Array<{ name: string, line: number }> = [];
    const classes: ClassInfo[] = [];
    const lines = content.split('\n');

    let currentClass: ClassInfo | null = null;
    let currentIndent = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const indent = getIndentLevel(line);

        // Class detection
        const classMatch = line.match(/^\s*class\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*[:\(]/);
        if (classMatch) {
            if (currentClass) {
                currentClass.end_line = i;
                classes.push(currentClass);
            }
            currentClass = {
                name: classMatch[1],
                methods: [],
                start_line: i + 1,
                end_line: lines.length // temporary
            };
            currentIndent = indent;
            continue;
        }

        // Function detection
        const funcMatch = line.match(/^\s*def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/);
        if (funcMatch) {
            if (currentClass && indent > currentIndent) {
                // This is a method
                currentClass.methods.push({
                    name: funcMatch[1],
                    line: i + 1
                });
            } else {
                // This is a standalone function
                functions.push({
                    name: funcMatch[1],
                    line: i + 1
                });
            }
            continue;
        }

        // Check for class end
        if (currentClass && indent <= currentIndent && line.trim()) {
            currentClass.end_line = i;
            classes.push(currentClass);
            currentClass = null;
        }
    }

    // Handle last class if exists
    if (currentClass) {
        currentClass.end_line = lines.length;
        classes.push(currentClass);
    }

    return { functions, classes };
}

// Enhanced import extraction with better error handling and support for complex imports
function extractImports(content: string): ImportInfo[] {
    const imports: ImportInfo[] = [];
    const lines = content.split('\n');
    let multiLineImport: string | null = null;
    let multiLineStart = 0;

    for (let i = 0; i < lines.length; i++) {
        try {
            let line = lines[i].trim();

            // Handle multi-line imports
            if (multiLineImport) {
                line = multiLineImport + ' ' + line;
                if (line.includes(')')) {
                    multiLineImport = null;
                    line = line.replace(/[\(\)]/g, '');
                } else {
                    multiLineImport += ' ' + line;
                    continue;
                }
            }

            // Start of multi-line import
            if (line.includes('(') && !line.includes(')')) {
                multiLineImport = line.replace('(', '');
                multiLineStart = i;
                continue;
            }

            // Regular imports
            const importMatch = line.match(/^import\s+(.+)$/);
            if (importMatch) {
                const modules = importMatch[1].split(',').map(m => m.trim());
                for (const module of modules) {
                    const aliasMatch = module.match(/^([a-zA-Z0-9_\.]+)\s+as\s+([a-zA-Z0-9_]+)$/);
                    if (aliasMatch) {
                        imports.push({
                            type: 'import',
                            module: aliasMatch[1],
                            alias: aliasMatch[2],
                            line: i + 1,
                            column: lines[i].indexOf(module)
                        });
                    } else {
                        imports.push({
                            type: 'import',
                            module: module,
                            line: i + 1,
                            column: lines[i].indexOf(module)
                        });
                    }
                }
                continue;
            }

            // From imports
            const fromImportMatch = line.match(/^from\s+([\.a-zA-Z0-9_]+)\s+import\s+(.+)$/);
            if (fromImportMatch) {
                const [, modulePath, importList] = fromImportMatch;
                const items = importList.split(',').map(item => item.trim());

                for (const item of items) {
                    if (!item) continue;

                    const aliasMatch = item.match(/^([a-zA-Z0-9_\.]+)\s+as\s+([a-zA-Z0-9_]+)$/);
                    if (aliasMatch) {
                        imports.push({
                            type: 'from_import',
                            module: modulePath,
                            import: aliasMatch[1],
                            alias: aliasMatch[2],
                            line: i + 1,
                            column: lines[i].indexOf(item)
                        });
                    } else if (item !== '*') {
                        imports.push({
                            type: 'from_import',
                            module: modulePath,
                            import: item,
                            line: i + 1,
                            column: lines[i].indexOf(item)
                        });
                    }
                }
            }
        } catch (error) {
            // console.warn(`Error parsing imports at line ${i + 1}:`, error);
        }
    }

    return imports;
}

function extractModuleName(filePath: string): string {
    const workspaceRoot = vscode.workspace.rootPath || '';
    let relativePath = filePath;

    if (workspaceRoot && filePath.startsWith(workspaceRoot)) {
        relativePath = filePath.substring(workspaceRoot.length + 1);
    }

    return relativePath
        .replace(/\\/g, '/')
        .replace(/^\/+/, '')
        .replace(/\.py$/, '')
        .replace(/\//g, '.');
}

// ========== NAVIGATION FUNCTIONS ==========
export async function nextLockedCaller() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !isLocked() || lockedCallerOccurrences.length === 0) {
        vscode.window.showInformationMessage('Lock a function via CodeLens first');
        return;
    }

    try {
        isNavigating = true; // Set flag before navigation
        lockedCallerIndex = (lockedCallerIndex + 1) % lockedCallerOccurrences.length;
        await navigateToOccurrence(editor, lockedCallerOccurrences[lockedCallerIndex]);
        // Reset flag after a short delay to allow the navigation to complete
        setTimeout(() => { isNavigating = false; }, 100);
    } catch (error) {
        isNavigating = false; // Reset flag on error
        // console.error('Failed to navigate to next caller:', error);
        vscode.window.showErrorMessage('Failed to navigate to next caller');
    }
}

export async function prevLockedCaller() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !isLocked() || lockedCallerOccurrences.length === 0) {
        vscode.window.showInformationMessage('Lock a function via CodeLens first');
        return;
    }

    try {
        isNavigating = true; // Set flag before navigation
        lockedCallerIndex = (lockedCallerIndex - 1 + lockedCallerOccurrences.length) % lockedCallerOccurrences.length;
        await navigateToOccurrence(editor, lockedCallerOccurrences[lockedCallerIndex]);
        // Reset flag after a short delay to allow the navigation to complete
        setTimeout(() => { isNavigating = false; }, 100);
    } catch (error) {
        isNavigating = false; // Reset flag on error
        // console.error('Failed to navigate to previous caller:', error);
        vscode.window.showErrorMessage('Failed to navigate to previous caller');
    }
}

async function navigateToOccurrence(editor: vscode.TextEditor, occurrence: CallerOccurrence) {
    let targetEditor = editor;

    if (occurrence.file_path && occurrence.file_path !== editor.document.uri.toString()) {
        // console.log(`[VERTEX] Navigating to different file: ${occurrence.file_path}`);
        // Use vscode.Uri.file for proper file path handling on Windows
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(occurrence.file_path));
        targetEditor = await vscode.window.showTextDocument(doc);
        // console.log(`[VERTEX] Opened new editor for file: ${targetEditor.document.uri.toString()}`);
    }

    const pos = new vscode.Position(
        occurrence.line - 1,
        occurrence.column
    );

    // Set the cursor position without selecting text to minimize interference with our decorations
    targetEditor.selection = new vscode.Selection(pos, pos);
    await targetEditor.revealRange(
        new vscode.Range(pos, pos),
        vscode.TextEditorRevealType.InCenterIfOutsideViewport
    );

    // Apply temporary highlight to make the navigation more visible
    const highlightRange = new vscode.Range(
        new vscode.Position(pos.line, occurrence.column),
        new vscode.Position(pos.line, occurrence.column + 10) // Highlight more of the function name
    );

    // console.log(`[VERTEX] Applying temporary highlight at position: ${pos.line}:${pos.character}`);
    targetEditor.setDecorations(temporaryHighlightDecorationType, [highlightRange]);

    // Clear the temporary highlight after a timeout
    const timeoutId = setTimeout(() => {
        // console.log(`[VERTEX] Clearing temporary highlight`);
        targetEditor.setDecorations(temporaryHighlightDecorationType, []);

        // Re-apply the persistent decorations to ensure they're visible
        updateCallerHighlights(targetEditor);
    }, 2000);

    // Ensure that the caller/callee highlights are maintained after navigation
    // Update highlights for the new editor if it's different from the original
    if (targetEditor !== editor) {
        // console.log(`[VERTEX] Updating caller highlights for new editor`);
        await updateCallerHighlights(targetEditor);
    } else {
        // Even for the same editor, we should refresh the highlights to ensure they're current
        await updateCallerHighlights(targetEditor);
    }

    vscode.window.setStatusBarMessage(
        `VERTEX: Caller ${lockedCallerIndex + 1} of ${lockedCallerOccurrences.length}`,
        2000
    );
}

// ========== LOCKING MECHANISMS ==========
export async function lockFunctionHighlights(functionName: string, context?: FuncContext) {
    try {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'python') {
            vscode.window.showInformationMessage('Open a Python file first');
            return;
        }

        // console.log(`[VERTEX] Locking function: ${functionName}`);
        locked = { name: functionName, context, file: editor.document.uri.toString() };
        const code = editor.document.getText();

        if (!code || code.trim().length === 0) {
            clearDecorations(editor);
            return;
        }

        const projectFiles = await collectProjectFiles();
        const projectContext = await buildProjectContext(projectFiles);

        // Find the correct target file where the function is defined
        let targetFile = editor.document.uri.toString();
        const functionSymbols = projectContext.symbol_table?.[functionName] || [];
        // console.log(`[VERTEX] Found ${functionSymbols.length} symbols for function ${functionName}`);
        if (functionSymbols.length > 0) {
            // If there are multiple functions with the same name, try to find the one closest to the cursor
            const cursorPosition = editor.selection.active;
            const cursorLine = cursorPosition.line + 1; // Convert to 1-based line numbers
            // console.log(`[VERTEX] Cursor position: line ${cursorLine}`);

            // First, check if there's a function definition in the current file at or before the cursor position
            const currentFileSymbols = functionSymbols.filter((symbol: SymbolInfo) =>
                symbol.file_path === editor.document.uri.fsPath);

            if (currentFileSymbols.length > 0) {
                // console.log(`[VERTEX] Found ${currentFileSymbols.length} symbols in current file`);
                // Sort by line number descending (closest to cursor first)
                currentFileSymbols.sort((a: SymbolInfo, b: SymbolInfo) => b.line - a.line);
                // Find the first function that's at or before the cursor
                const closestSymbol = currentFileSymbols.find((symbol: SymbolInfo) => symbol.line <= cursorLine);
                if (closestSymbol) {
                    targetFile = closestSymbol.file_path;
                    // console.log(`[VERTEX] Found function ${functionName} in current file at line ${closestSymbol.line}`);
                } else {
                    // If no function before cursor, use the first one
                    targetFile = currentFileSymbols[0].file_path;
                    // console.log(`[VERTEX] Found function ${functionName} in current file (no function before cursor)`);
                }
            } else {
                // Use the first symbol's file path as the target file
                targetFile = functionSymbols[0].file_path;
                // console.log(`[VERTEX] Found function ${functionName} in file: ${targetFile}`);
            }
        }

        // console.log(`[VERTEX] Target file for analysis: ${targetFile}`);
        // Get highlights directly from the backend with cross-file analysis
        const highlights = await backendClient.getHighlightsFromProject(
            projectFiles,
            projectContext,
            targetFile,
            functionName,
            context
        );

        //console.log(`[VERTEX] Backend response:`, highlights);

        lockedCallerOccurrences = highlights.callers.map((caller: any) => ({
            line: caller.line,
            column: caller.range.start_column,
            file_path: caller.file_path || editor.document.uri.toString()
        }));
        lockedCallerIndex = 0;

        await updateCallerHighlights(editor);
        vscode.window.setStatusBarMessage(
            `VERTEX: Locked on ${functionName}() — ${lockedCallerOccurrences.length} callers found`,
            3000
        );
    } catch (error) {
        // console.error('Failed to lock function highlights:', error);
        vscode.window.showErrorMessage('Failed to lock function highlights');
        unlockFunctionHighlights();
    }
}

export async function lockFunctionByName(functionName: string) {
    try {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'python') {
            vscode.window.showInformationMessage('Open a Python file first');
            return;
        }

        const code = editor.document.getText();
        const projectFiles = await collectProjectFiles();
        const projectContext = await buildProjectContext(projectFiles);
        const analysis = await backendClient.analyzeProject(
            projectFiles,
            projectContext,
            editor.document.uri.toString()
        );

        const matches = (analysis.functions || [])
            .filter((f) => f.name === functionName)
            .sort((a, b) => (b.end_line - b.line) - (a.end_line - a.line));

        const ctx = matches.length > 0
            ? { line: matches[0].line, end_line: matches[0].end_line }
            : undefined;

        await lockFunctionHighlights(functionName, ctx);
    } catch (error) {
        // console.error('Failed to lock function by name:', error);
        vscode.window.showErrorMessage('Failed to lock function by name');
    }
}

export async function unlockFunctionHighlights() {
    locked = null;
    lockedCallerOccurrences = [];
    lockedCallerIndex = -1;

    // Clear decorations from ALL open Python editors, not just the current one
    const openEditors = vscode.window.visibleTextEditors;
    for (const editor of openEditors) {
        if (editor.document.languageId === 'python') {
            clearDecorations(editor);
        }
    }

    // Clear stored decorations
    editorDecorations.clear();

    vscode.window.setStatusBarMessage('VERTEX: Unlocked', 1500);
}

// ========== HIGHLIGHT UPDATES ==========
export async function updateCallerHighlights(editor: vscode.TextEditor | undefined) {
    // console.log(`[VERTEX] updateCallerHighlights called with editor: ${editor ? editor.document.uri.toString() : 'undefined'}`);

    if (!editor || editor.document.languageId !== 'python') {
        // console.log(`[VERTEX] Invalid editor or not Python file, returning`);
        return;
    }

    const config = getConfig();
    const code = editor.document.getText();

    if (!code || code.trim().length === 0) {
        // console.log(`[VERTEX] Empty code, clearing decorations`);
        clearDecorations(editor);
        return;
    }

    try {
        if (locked) {
            // console.log(`[VERTEX] Function is locked: ${locked.name}`);
            const projectFiles = await collectProjectFiles();
            const projectContext = await buildProjectContext(projectFiles);

            // Find the correct target file where the function is defined
            // Use the same logic as in lockFunctionHighlights
            let targetFile = editor.document.uri.toString();
            const functionSymbols = projectContext.symbol_table?.[locked.name] || [];
            // console.log(`[VERTEX] Found ${functionSymbols.length} symbols for function ${locked.name} in updateCallerHighlights`);
            if (functionSymbols.length > 0) {
                // If there are multiple functions with the same name, try to find the one closest to the cursor
                const cursorPosition = editor.selection.active;
                const cursorLine = cursorPosition.line + 1; // Convert to 1-based line numbers
                // console.log(`[VERTEX] Cursor position: line ${cursorLine}`);

                // First, check if there's a function definition in the current file at or before the cursor position
                const currentFileSymbols = functionSymbols.filter((symbol: SymbolInfo) =>
                    symbol.file_path === editor.document.uri.fsPath);

                if (currentFileSymbols.length > 0) {
                    // console.log(`[VERTEX] Found ${currentFileSymbols.length} symbols in current file`);
                    // Sort by line number descending (closest to cursor first)
                    currentFileSymbols.sort((a: SymbolInfo, b: SymbolInfo) => b.line - a.line);
                    // Find the first function that's at or before the cursor
                    const closestSymbol = currentFileSymbols.find((symbol: SymbolInfo) => symbol.line <= cursorLine);
                    if (closestSymbol) {
                        targetFile = closestSymbol.file_path;
                        // console.log(`[VERTEX] Found function ${locked.name} in current file at line ${closestSymbol.line}`);
                    } else {
                        // If no function before cursor, use the first one
                        targetFile = currentFileSymbols[0].file_path;
                        // console.log(`[VERTEX] Found function ${locked.name} in current file (no function before cursor)`);
                    }
                } else {
                    // Use the first symbol's file path as the target file
                    targetFile = functionSymbols[0].file_path;
                    // console.log(`[VERTEX] Found function ${locked.name} in file: ${targetFile}`);
                }
            }

            // console.log(`[VERTEX] Target file determined to be: ${targetFile}`);

            let ctx = locked.context;
            if (!ctx) {
                // console.log(`[VERTEX] No context found, computing context`);
                const analysis = await backendClient.analyzeProject(
                    projectFiles,
                    projectContext,
                    targetFile
                );

                const matches = (analysis.functions || [])
                    .filter((f) => f.name === locked!.name)
                    .sort((a, b) => (b.end_line - b.line) - (a.end_line - a.line));

                if (matches.length > 0) {
                    ctx = {
                        line: matches[0].line,
                        end_line: matches[0].end_line
                    };
                    locked = { ...locked, context: ctx };
                    // console.log(`[VERTEX] Computed context: line ${ctx.line} to ${ctx.end_line}`);
                }
            }

            // Get highlights directly from the backend with cross-file analysis
            // console.log(`[VERTEX] Requesting highlights from backend`);
            const highlights = await backendClient.getHighlightsFromProject(
                projectFiles,
                projectContext,
                targetFile,
                locked.name,
                ctx
            );

            // console.log(`[VERTEX] Received highlights: ${highlights.total_callers} callers, ${highlights.total_callees} callees`);

            // Update locked caller occurrences to ensure navigation works correctly
            lockedCallerOccurrences = (highlights.callers as HighlightInfo[]).map((caller) => ({
                line: caller.line,
                column: caller.range.start_column,
                file_path: caller.file_path || editor.document.uri.toString()
            }));
            // Keep the current index if it's still valid, otherwise reset to 0
            if (lockedCallerIndex >= lockedCallerOccurrences.length) {
                lockedCallerIndex = 0;
            }

            // Group decorations by file path
            const decorationsByFile: Record<string, { callers: vscode.DecorationOptions[], callees: vscode.DecorationOptions[] }> = {};

            // Initialize with ALL currently open editors to ensure we clear decorations properly
            const openEditors = vscode.window.visibleTextEditors;
            for (const openEditor of openEditors) {
                if (openEditor.document.languageId === 'python') {
                    decorationsByFile[openEditor.document.uri.toString()] = { callers: [], callees: [] };
                }
            }

            if (config.showCallerHighlights && highlights.callers) {
                // console.log(`[VERTEX] Processing ${highlights.callers.length} callers`);
                // console.log(`[VERTEX] Processing ${highlights.callees.length} callees`);
                // console.log(`[VERTEX] Callees data:`, highlights.callees);
                for (const caller of highlights.callers as HighlightInfo[]) {
                    // Normalize file paths for consistent comparison
                    const filePath = caller.file_path ?
                        vscode.Uri.file(caller.file_path).toString() :
                        editor.document.uri.toString();
                    if (!decorationsByFile[filePath]) {
                        decorationsByFile[filePath] = { callers: [], callees: [] };
                    }

                    const line0 = caller.line - 1;
                    const range = new vscode.Range(
                        new vscode.Position(line0, caller.range.start_column),
                        new vscode.Position(line0, caller.range.end_column)
                    );
                    const hover = new vscode.MarkdownString();
                    hover.appendMarkdown(`**↑ Caller of** \`${locked!.name}()\``);
                    if (caller.file_path && caller.file_path !== editor.document.uri.toString()) {
                        hover.appendMarkdown(`\n\nIn file: \`${caller.file_path}\``);
                    }

                    decorationsByFile[filePath].callers.push({ range, hoverMessage: hover });
                }
            }

            if (config.showCalleeHighlights && highlights.callees) {
                // console.log(`[VERTEX] Processing ${highlights.callees.length} callees`);
                for (const callee of highlights.callees as HighlightInfo[]) {
                    // For callees, they should be in the file where the locked function is defined
                    // This is the target file we determined above
                    // Normalize file path for consistent comparison
                    const filePath = vscode.Uri.file(targetFile).toString();
                    if (!decorationsByFile[filePath]) {
                        decorationsByFile[filePath] = { callers: [], callees: [] };
                    }

                    const line0 = callee.line - 1;
                    const range = new vscode.Range(
                        new vscode.Position(line0, callee.range.start_column),
                        new vscode.Position(line0, callee.range.end_column)
                    );
                    const hover = new vscode.MarkdownString();
                    hover.appendMarkdown(
                        `**↓ Callee** — \`${locked!.name}()\` calls \`${callee.function_name}()\``
                    );

                    decorationsByFile[filePath].callees.push({ range, hoverMessage: hover });
                }
            }

            // Apply decorations to the correct editors
            // console.log(`[VERTEX] Applying decorations to ${Object.keys(decorationsByFile).length} files`);

            // Get the current list of open editors right before applying decorations
            // This ensures we have the most up-to-date list after navigation
            const currentOpenEditors = vscode.window.visibleTextEditors;

            for (const [filePath, decorations] of Object.entries(decorationsByFile)) {
                // console.log(`[VERTEX] File: ${filePath}, Callers: ${decorations.callers.length}, Callees: ${decorations.callees.length}`);

                // Find the editor for this file path using normalized paths
                const targetEditor = currentOpenEditors.find(ed => ed.document.uri.toString() === filePath);

                if (targetEditor) {
                    // Store decorations for persistence
                    editorDecorations.set(filePath, decorations);

                    // Apply decorations to the correct editor
                    // console.log(`[VERTEX] Applying decorations to editor for ${filePath}`);
                    targetEditor.setDecorations(callerDecorationType, decorations.callers);
                    targetEditor.setDecorations(calleeDecorationType, decorations.callees);

                    // Force a refresh of the editor to ensure decorations are visible
                    // This helps overcome VS Code's native selection highlighting
                    setTimeout(() => {
                        if (targetEditor.document) {
                            targetEditor.setDecorations(callerDecorationType, decorations.callers);
                            targetEditor.setDecorations(calleeDecorationType, decorations.callees);
                        }
                    }, 100);
                } else {
                    // console.log(`[VERTEX] File ${filePath} is not currently open, skipping decorations`);
                }
            }

            // Also apply decorations to the current editor to ensure it's properly highlighted
            // This is especially important when navigating between files
            if (editor) {
                const currentFilePath = editor.document.uri.toString();
                if (decorationsByFile[currentFilePath]) {
                    editor.setDecorations(callerDecorationType, decorationsByFile[currentFilePath].callers);
                    editor.setDecorations(calleeDecorationType, decorationsByFile[currentFilePath].callees);
                    // Store the decorations
                    editorDecorations.set(currentFilePath, decorationsByFile[currentFilePath]);
                }
            }
        } else {
            // console.log(`[VERTEX] No function locked, clearing decorations`);
            clearDecorations(editor);
        }
    } catch (error) {
        // console.error('[VERTEX] Failed to update highlights:', error);
        clearDecorations(editor);
    }
}

// ========== EVENT HANDLERS ==========
export function registerLockModeEventHandlers(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(async (e) => {
            const editor = vscode.window.activeTextEditor;
            // console.log(`[VERTEX] onDidChangeTextDocument triggered`);
            if (!editor || e.document !== editor.document) return;

            if (locked) {
                // console.log(`[VERTEX] Text changed in active editor, updating highlights`);
                // Clear cache when text changes
                await updateCallerHighlights(editor);
            }
        }),
        vscode.window.onDidChangeActiveTextEditor(async (editor) => {
            // console.log(`[VERTEX] onDidChangeActiveTextEditor triggered with editor: ${editor ? editor.document.uri.toString() : 'undefined'}`);
            if (editor && editor.document.languageId === 'python' && locked) {
                // console.log(`[VERTEX] Active editor changed to Python file with locked function, updating highlights`);
                // Add a small delay to ensure the editor is fully loaded
                setTimeout(async () => {
                    await updateCallerHighlights(editor);
                }, 200);
            } else if (editor && editor.document.languageId === 'python' && !locked) {
                // Even when not locked, clear any existing decorations
                clearDecorations(editor);
            }

            // Re-apply stored decorations to ensure persistence
            if (editor && editor.document.languageId === 'python' && locked) {
                const filePath = editor.document.uri.toString();
                const storedDecorations = editorDecorations.get(filePath);
                if (storedDecorations) {
                    editor.setDecorations(callerDecorationType, storedDecorations.callers);
                    editor.setDecorations(calleeDecorationType, storedDecorations.callees);
                }
            }
        }),
        vscode.workspace.onDidChangeConfiguration(async (e) => {
            if (e.affectsConfiguration('vertex')) {
                const editor = vscode.window.activeTextEditor;
                // console.log(`[VERTEX] Configuration changed, updating highlights`);
                if (editor && locked) {
                    await updateCallerHighlights(editor);
                }
            }
        }),
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            // Clear cache when workspace folders change
            // console.log(`[VERTEX] Workspace folders changed, clearing cache`);
        }),
        // Unlock function when user presses any key (except navigation keys)
        vscode.window.onDidChangeTextEditorSelection(async (e) => {
            if (!locked || isNavigating) return;

            const editor = e.textEditor;
            if (!editor || editor.document.languageId !== 'python') return;

            // If selection changed due to user interaction (not our navigation), unlock
            // This will trigger on any cursor movement, including typing, clicking, arrow keys, etc.
            await unlockFunctionHighlights();
        })
    );
}

export function disposeDecorations() {
    callerDecorationType.dispose();
    calleeDecorationType.dispose();
    temporaryHighlightDecorationType.dispose();
    editorDecorations.clear();
}