# VERTEX - Python Code Analysis (Beta)

> 🚀 Real-time cross-file Python analysis with visual highlighting and dead code detection

## ⚠️ Beta Software Notice

VERTEX is currently in **beta**. While fully functional, you may encounter minor issues. Please report bugs and share feedback to help improve the extension!

## ✨ What Makes VERTEX Unique

- **🎯 Real-time cross-file analysis** - Understands your entire Python project
- **🎨 Visual code highlighting** - See caller/callee relationships directly in your editor  
- **⚡ Interactive navigation** - Lock on functions and navigate with keyboard shortcuts
- **💀 Smart dead code detection** - Find unused functions across your entire project
- **📊 Inline statistics** - See caller/callee counts above each function

## 🚀 Quick Start

1. **Install** the extension from VS Code marketplace
2. **Open** any Python project
3. **See CodeLens** appear above your functions showing caller/callee counts
4. **Click CodeLens** to lock highlighting on a function
5. **Use `Alt+]` and `Alt+[`** to navigate between callers

## 🎯 Key Features

### Visual Code Relationships
- **Orange highlights**: Lines that call your current function
- **Pink highlights**: Functions called by your current function  
- **Real-time updates** as you navigate through code

### Dead Code Detection
- **Project-wide analysis** finds truly unused functions
- **Cross-file intelligence** knows if functions are called from other files
- **Smart exclusions** for entry points and special methods

### Interactive Navigation
- **Lock mode**: Focus on one function's relationships
- **Keyboard shortcuts**: Navigate quickly between related code
- **Cross-file navigation**: Jump between files seamlessly

## ⌨️ Keyboard Shortcuts

- `Alt+]` - Navigate to next caller
- `Alt+[` - Navigate to previous caller  
- `Esc` - Exit navigation mode
- `Ctrl+Shift+D` (Windows/Linux) / `Cmd+Shift+D` (Mac) - Analyze dead code

## 🛠️ Commands

- `VERTEX: Analyze Dead Code (Project-wide)` - Run manual dead code analysis across entire project
- `VERTEX: Test Backend Connection` - Check if analysis server is running

### Dead Code Analysis Behavior

- **Initial Analysis**: Runs automatically 2 seconds after opening a workspace (if enabled in settings)
- **Manual Analysis**: Use `Ctrl+Shift+D` or command palette to run on-demand
- **No Auto-refresh**: Dead code analysis no longer runs on every keystroke for better performance

## ⚙️ Configuration

Customize VERTEX through VS Code settings:

- `vertex.showCallerHighlights` - Show orange caller highlights
- `vertex.showCalleeHighlights` - Show pink callee highlights  
- `vertex.showCodeLens` - Show inline statistics above functions
- `vertex.showUnusedWarnings` - Show dead code warnings
- `vertex.exclude` - File patterns to exclude from analysis

## 🐛 Known Limitations (Beta)

- Large projects (500+ files) may experience slower analysis
- Some complex import patterns might not be fully resolved
- Occasional file collection timing issues

## 📞 Support & Feedback

- **Questions**: Open an issue with the "question" label

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

---

**Made with ❤️ for the Python community**