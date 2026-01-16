import { useState, useEffect } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  filesystemAPI,
  type StartingPath,
  type DirectoryEntry,
} from "../../lib/api";
import {
  Folder,
  FolderOpen,
  FolderPlus,
  ChevronRight,
  ChevronUp,
  Home,
  Loader2,
  AlertCircle,
  Check,
  X,
} from "lucide-react";
import { cn } from "../../lib/utils";

interface DirectoryBrowserProps {
  value: string;
  onChange: (path: string) => void;
  suggestedName?: string; // Suggested folder name (e.g., project name)
}

export function DirectoryBrowser({ value, onChange, suggestedName }: DirectoryBrowserProps) {
  const [startingPaths, setStartingPaths] = useState<StartingPath[]>([]);
  const [currentPath, setCurrentPath] = useState<string>("");
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [entries, setEntries] = useState<DirectoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualPath, setManualPath] = useState(value);
  const [showManualInput, setShowManualInput] = useState(false);

  // New folder creation state
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);

  // Load starting paths on mount
  useEffect(() => {
    filesystemAPI.getStartingPaths().then(setStartingPaths).catch(console.error);
  }, []);

  // Browse to a directory
  const browseTo = async (path: string) => {
    setLoading(true);
    setError(null);
    setIsCreatingFolder(false);

    try {
      const result = await filesystemAPI.browse(path);
      setCurrentPath(result.currentPath);
      setParentPath(result.parentPath);
      setEntries(result.entries);
      onChange(result.currentPath);
      setManualPath(result.currentPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to browse directory");
    } finally {
      setLoading(false);
    }
  };

  // Go to parent directory
  const goUp = () => {
    if (parentPath) {
      browseTo(parentPath);
    }
  };

  // Handle manual path input
  const handleManualPathSubmit = async () => {
    if (!manualPath.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const result = await filesystemAPI.validate(manualPath.trim());
      if (result.valid) {
        await browseTo(manualPath.trim());
        setShowManualInput(false);
      } else {
        setError("Invalid directory path");
      }
    } catch (err) {
      setError("Invalid directory path");
    } finally {
      setLoading(false);
    }
  };

  // Create a new folder
  const handleCreateFolder = async () => {
    if (!newFolderName.trim() || !currentPath) return;

    setCreatingFolder(true);
    setError(null);

    try {
      const newPath = `${currentPath}/${newFolderName.trim()}`;
      const result = await filesystemAPI.createDirectory(newPath);

      if (result.success) {
        // Navigate to the new folder
        await browseTo(result.path);
        setNewFolderName("");
        setIsCreatingFolder(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create folder");
    } finally {
      setCreatingFolder(false);
    }
  };

  // Start creating a new folder with suggested name
  const startCreatingFolder = () => {
    setIsCreatingFolder(true);
    setNewFolderName(suggestedName || "");
  };

  // Breadcrumb parts
  const pathParts = currentPath.split("/").filter(Boolean);

  return (
    <div className="space-y-3">
      {/* Current path display / manual input toggle */}
      <div className="flex items-center gap-2">
        {showManualInput ? (
          <div className="flex-1 flex gap-2">
            <Input
              value={manualPath}
              onChange={(e) => setManualPath(e.target.value)}
              placeholder="/path/to/directory"
              className="font-mono text-sm flex-1"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleManualPathSubmit();
                } else if (e.key === "Escape") {
                  setShowManualInput(false);
                  setManualPath(currentPath);
                }
              }}
            />
            <Button size="sm" onClick={handleManualPathSubmit} disabled={loading}>
              Go
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setShowManualInput(false);
                setManualPath(currentPath);
              }}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <>
            <div
              className="flex-1 bg-muted rounded-md px-3 py-2 text-sm font-mono truncate cursor-pointer hover:bg-muted/80"
              onClick={() => setShowManualInput(true)}
              title="Click to type a path manually"
            >
              {currentPath || "Select a directory..."}
            </div>
            {currentPath && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowManualInput(true)}
                title="Type path manually"
              >
                Edit
              </Button>
            )}
          </>
        )}
      </div>

      {/* Quick access buttons */}
      {!currentPath && startingPaths.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Quick access:</p>
          <div className="flex flex-wrap gap-2">
            {startingPaths.map((sp) => (
              <Button
                key={sp.path}
                variant="outline"
                size="sm"
                className="text-xs"
                onClick={() => browseTo(sp.path)}
              >
                <Home className="h-3 w-3 mr-1" />
                {sp.name}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Breadcrumb navigation */}
      {currentPath && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground overflow-x-auto pb-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1"
            onClick={() => browseTo("/")}
          >
            /
          </Button>
          {pathParts.map((part, i) => {
            const pathUpTo = "/" + pathParts.slice(0, i + 1).join("/");
            const isLast = i === pathParts.length - 1;
            return (
              <div key={pathUpTo} className="flex items-center">
                <ChevronRight className="h-3 w-3" />
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-6 px-1",
                    isLast && "font-medium text-foreground"
                  )}
                  onClick={() => !isLast && browseTo(pathUpTo)}
                  disabled={isLast}
                >
                  {part}
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-400 p-2 rounded-md">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Directory listing */}
      {currentPath && (
        <div className="border rounded-md max-h-64 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center p-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="divide-y">
              {/* Parent directory */}
              {parentPath && (
                <button
                  className="w-full flex items-center gap-2 p-2 hover:bg-muted text-left"
                  onClick={goUp}
                >
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">..</span>
                </button>
              )}

              {/* New folder input */}
              {isCreatingFolder && (
                <div className="flex items-center gap-2 p-2 bg-blue-50 dark:bg-blue-900/20">
                  <FolderPlus className="h-4 w-4 text-blue-500" />
                  <Input
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    placeholder="New folder name"
                    className="h-7 text-sm flex-1"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        handleCreateFolder();
                      } else if (e.key === "Escape") {
                        setIsCreatingFolder(false);
                        setNewFolderName("");
                      }
                    }}
                  />
                  <Button
                    size="sm"
                    className="h-7 px-2"
                    onClick={handleCreateFolder}
                    disabled={creatingFolder || !newFolderName.trim()}
                  >
                    {creatingFolder ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Check className="h-3 w-3" />
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2"
                    onClick={() => {
                      setIsCreatingFolder(false);
                      setNewFolderName("");
                    }}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              )}

              {/* Directories */}
              {entries.length === 0 && !parentPath && !isCreatingFolder && (
                <div className="p-4 text-sm text-muted-foreground text-center">
                  No subdirectories
                </div>
              )}

              {entries.map((entry) => (
                <button
                  key={entry.path}
                  className="w-full flex items-center gap-2 p-2 hover:bg-muted text-left group"
                  onClick={() => browseTo(entry.path)}
                >
                  <Folder className="h-4 w-4 text-blue-500 group-hover:hidden" />
                  <FolderOpen className="h-4 w-4 text-blue-500 hidden group-hover:block" />
                  <span className="text-sm truncate">{entry.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Create new folder button */}
      {currentPath && !isCreatingFolder && (
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={startCreatingFolder}
        >
          <FolderPlus className="h-4 w-4 mr-2" />
          Create New Folder{suggestedName ? ` "${suggestedName}"` : ""}
        </Button>
      )}

      {/* Selected path confirmation */}
      {currentPath && (
        <p className="text-xs text-muted-foreground">
          Selected: <code className="bg-muted px-1 rounded">{currentPath}</code>
        </p>
      )}
    </div>
  );
}
