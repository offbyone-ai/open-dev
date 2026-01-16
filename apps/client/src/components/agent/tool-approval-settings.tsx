import { useState, useEffect, cloneElement, isValidElement } from "react";
import { Settings, FileText, FolderOpen, FileEdit, Trash2, Terminal, CheckCircle } from "lucide-react";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Switch } from "../ui/switch";
import { Label } from "../ui/label";
import { agentAPI, type ToolApprovalSettings, DEFAULT_TOOL_APPROVAL_SETTINGS } from "../../lib/api";

interface ToolApprovalSettingsDialogProps {
  projectId: string;
  trigger?: React.ReactElement;
}

interface ToolConfig {
  key: keyof ToolApprovalSettings;
  label: string;
  description: string;
  icon: React.ReactNode;
  dangerous?: boolean;
}

const TOOL_CONFIGS: ToolConfig[] = [
  {
    key: "readFile",
    label: "Read File",
    description: "Read file contents from the working directory",
    icon: <FileText className="h-4 w-4" />,
  },
  {
    key: "listDirectory",
    label: "List Directory",
    description: "List files and folders in a directory",
    icon: <FolderOpen className="h-4 w-4" />,
  },
  {
    key: "writeFile",
    label: "Write File",
    description: "Create or overwrite files",
    icon: <FileEdit className="h-4 w-4" />,
    dangerous: true,
  },
  {
    key: "editFile",
    label: "Edit File",
    description: "Search and replace text in files",
    icon: <FileEdit className="h-4 w-4" />,
    dangerous: true,
  },
  {
    key: "deleteFile",
    label: "Delete File",
    description: "Delete files from the working directory",
    icon: <Trash2 className="h-4 w-4" />,
    dangerous: true,
  },
  {
    key: "executeCommand",
    label: "Execute Command",
    description: "Run shell commands in the working directory",
    icon: <Terminal className="h-4 w-4" />,
    dangerous: true,
  },
  {
    key: "completeTask",
    label: "Complete Task",
    description: "Mark the task as done",
    icon: <CheckCircle className="h-4 w-4" />,
  },
];

export function ToolApprovalSettingsDialog({
  projectId,
  trigger,
}: ToolApprovalSettingsDialogProps) {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<ToolApprovalSettings>(DEFAULT_TOOL_APPROVAL_SETTINGS);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Load settings when dialog opens
  useEffect(() => {
    if (open) {
      setLoading(true);
      agentAPI.getToolApprovalSettings(projectId)
        .then((data) => {
          setSettings({ ...DEFAULT_TOOL_APPROVAL_SETTINGS, ...data });
        })
        .catch((err) => {
          console.error("Failed to load tool approval settings:", err);
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [open, projectId]);

  const handleToggle = (key: keyof ToolApprovalSettings) => {
    setSettings((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await agentAPI.updateToolApprovalSettings(projectId, settings);
      setOpen(false);
    } catch (err) {
      console.error("Failed to save tool approval settings:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleTriggerClick = () => setOpen(true);

  const defaultTrigger = (
    <Button variant="ghost" size="sm" onClick={handleTriggerClick}>
      <Settings className="h-4 w-4 mr-2" />
      Tool Settings
    </Button>
  );

  // Clone the trigger element and add onClick handler
  const triggerElement = trigger && isValidElement(trigger)
    ? cloneElement(trigger, { onClick: handleTriggerClick } as React.HTMLAttributes<HTMLElement>)
    : defaultTrigger;

  return (
    <>
      {triggerElement}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Tool Approval Settings</DialogTitle>
          <DialogDescription>
            Configure which agent tools require your approval before executing.
            Tools that don't require approval will execute immediately.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-8 text-center text-muted-foreground">
            Loading settings...
          </div>
        ) : (
          <div className="space-y-4 py-4">
            {TOOL_CONFIGS.map((tool) => (
              <div
                key={tool.key}
                className="flex items-center justify-between gap-4"
              >
                <div className="flex items-center gap-3 flex-1">
                  <div className={`p-2 rounded-md ${tool.dangerous ? 'bg-orange-500/10 text-orange-500' : 'bg-muted'}`}>
                    {tool.icon}
                  </div>
                  <div className="flex-1">
                    <Label
                      htmlFor={tool.key}
                      className="text-sm font-medium cursor-pointer"
                    >
                      {tool.label}
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      {tool.description}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {settings[tool.key] ? "Approval" : "Immediate"}
                  </span>
                  <Switch
                    id={tool.key}
                    checked={settings[tool.key] ?? false}
                    onCheckedChange={() => handleToggle(tool.key)}
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || loading}>
            {saving ? "Saving..." : "Save Settings"}
          </Button>
        </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
