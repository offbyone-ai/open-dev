import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import { agentAPI, type Project } from "../../lib/api";
import { DirectoryBrowser } from "./directory-browser";
import { FolderOpen, AlertTriangle } from "lucide-react";

interface WorkingDirectorySetupProps {
  project: Project;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
}

export function WorkingDirectorySetup({
  project,
  open,
  onOpenChange,
  onComplete,
}: WorkingDirectorySetupProps) {
  const [workingDirectory, setWorkingDirectory] = useState(
    project.workingDirectory || ""
  );
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setWorkingDirectory(project.workingDirectory || "");
      setError(null);
    }
  }, [open, project.workingDirectory]);

  const handleSave = async () => {
    if (!workingDirectory.trim()) {
      setError("Please select a working directory");
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      await agentAPI.setWorkingDirectory(project.id, workingDirectory.trim(), true);
      await onComplete(); // Wait for project refresh before closing
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set working directory");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5" />
            Configure Working Directory
          </DialogTitle>
          <DialogDescription>
            Select the root directory where the AI agent can read, create, and modify files.
            The agent will only have access to files within this directory.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Select Directory</Label>
            <DirectoryBrowser
              value={workingDirectory}
              onChange={setWorkingDirectory}
              suggestedName={project.name.toLowerCase().replace(/\s+/g, "-")}
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 dark:bg-red-900/20 dark:text-red-400 p-3 rounded-md">
              <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-amber-800 dark:text-amber-200">
                <p className="font-medium">Important</p>
                <p className="mt-1">
                  The AI agent will be able to read, create, edit, and delete files within
                  this directory. All file operations require your explicit approval before
                  being executed.
                </p>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving || !workingDirectory}>
            {isSaving ? "Saving..." : "Confirm Directory"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
