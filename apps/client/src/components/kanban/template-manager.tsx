import { useState, useEffect } from "react";
import type { TaskTemplate, CreateTaskTemplate, TaskPriority } from "../../lib/api";
import { taskTemplatesAPI } from "../../lib/api";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import { Select } from "../ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../ui/dialog";
import { Badge } from "../ui/badge";
import { Plus, Pencil, Trash2 } from "lucide-react";

interface TemplateManagerProps {
  projectId: string;
  open: boolean;
  onClose: () => void;
}

const priorityOptions = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

const priorityColors: Record<TaskPriority, string> = {
  low: "bg-green-500/10 text-green-500 border-green-500/20",
  medium: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
  high: "bg-red-500/10 text-red-500 border-red-500/20",
};

// Common task template categories
const categoryOptions = [
  { value: "", label: "No Category" },
  { value: "Development", label: "Development" },
  { value: "Bug Fix", label: "Bug Fix" },
  { value: "Feature", label: "Feature" },
  { value: "Documentation", label: "Documentation" },
  { value: "Testing", label: "Testing" },
  { value: "DevOps", label: "DevOps" },
  { value: "Refactoring", label: "Refactoring" },
];

export function TemplateManager({ projectId, open, onClose }: TemplateManagerProps) {
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingTemplate, setEditingTemplate] = useState<TaskTemplate | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [acceptanceCriteria, setAcceptanceCriteria] = useState("");
  const [defaultPriority, setDefaultPriority] = useState<TaskPriority>("medium");
  const [category, setCategory] = useState("");

  useEffect(() => {
    if (open) {
      loadTemplates();
    }
  }, [open, projectId]);

  const loadTemplates = async () => {
    setLoading(true);
    try {
      const data = await taskTemplatesAPI.list(projectId);
      setTemplates(data);
    } catch (err) {
      console.error("Failed to load templates:", err);
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setName("");
    setDescription("");
    setAcceptanceCriteria("");
    setDefaultPriority("medium");
    setCategory("");
    setError("");
  };

  const openCreateForm = () => {
    resetForm();
    setEditingTemplate(null);
    setIsCreating(true);
  };

  const openEditForm = (template: TaskTemplate) => {
    setName(template.name);
    setDescription(template.description || "");
    setAcceptanceCriteria(template.acceptanceCriteria || "");
    setDefaultPriority(template.defaultPriority);
    setCategory(template.category || "");
    setEditingTemplate(template);
    setIsCreating(true);
    setError("");
  };

  const closeForm = () => {
    setIsCreating(false);
    setEditingTemplate(null);
    resetForm();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Name is required");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const data: CreateTaskTemplate = {
        name: name.trim(),
        description: description.trim() || undefined,
        acceptanceCriteria: acceptanceCriteria.trim() || undefined,
        defaultPriority,
        category: category || undefined,
      };

      if (editingTemplate) {
        await taskTemplatesAPI.update(projectId, editingTemplate.id, data);
      } else {
        await taskTemplatesAPI.create(projectId, data);
      }

      await loadTemplates();
      closeForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save template");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (templateId: string) => {
    if (!confirm("Are you sure you want to delete this template?")) return;

    try {
      await taskTemplatesAPI.delete(projectId, templateId);
      await loadTemplates();
    } catch (err) {
      console.error("Failed to delete template:", err);
    }
  };

  // Group templates by category
  const groupedTemplates = templates.reduce((acc, template) => {
    const cat = template.category || "Uncategorized";
    if (!acc[cat]) {
      acc[cat] = [];
    }
    acc[cat].push(template);
    return acc;
  }, {} as Record<string, TaskTemplate[]>);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {isCreating
              ? editingTemplate
                ? "Edit Template"
                : "Create Template"
              : "Manage Templates"}
          </DialogTitle>
        </DialogHeader>

        {isCreating ? (
          <form onSubmit={handleSubmit} className="space-y-4 overflow-y-auto flex-1 -mx-6 px-6">
            {error && (
              <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-md">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="template-name">Template Name *</Label>
              <Input
                id="template-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Add API Endpoint"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="template-category">Category</Label>
                <Select
                  id="template-category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  options={categoryOptions}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="template-priority">Default Priority</Label>
                <Select
                  id="template-priority"
                  value={defaultPriority}
                  onChange={(e) => setDefaultPriority(e.target.value as TaskPriority)}
                  options={priorityOptions}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="template-description">Description Template</Label>
              <Textarea
                id="template-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Pre-filled description for tasks using this template..."
                rows={3}
              />
              <p className="text-xs text-muted-foreground">
                This text will be pre-filled in the task description when using this template.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="template-acceptance">Acceptance Criteria Template</Label>
              <Textarea
                id="template-acceptance"
                value={acceptanceCriteria}
                onChange={(e) => setAcceptanceCriteria(e.target.value)}
                placeholder="- [ ] Criterion 1&#10;- [ ] Criterion 2&#10;- [ ] Tests pass"
                rows={4}
              />
              <p className="text-xs text-muted-foreground">
                Define standard acceptance criteria. Use markdown checkboxes for clarity.
              </p>
            </div>

            <DialogFooter className="gap-2 pt-4">
              <Button type="button" variant="outline" onClick={closeForm}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving..." : editingTemplate ? "Save Changes" : "Create Template"}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="overflow-y-auto flex-1 -mx-6 px-6">
            <div className="mb-4">
              <Button onClick={openCreateForm} className="gap-2">
                <Plus className="h-4 w-4" />
                New Template
              </Button>
            </div>

            {loading ? (
              <div className="text-center py-8 text-muted-foreground">
                Loading templates...
              </div>
            ) : templates.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <p className="mb-2">No templates yet</p>
                <p className="text-sm">
                  Create templates for common task patterns like "Add API endpoint" or "Fix bug"
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {Object.entries(groupedTemplates).map(([cat, categoryTemplates]) => (
                  <div key={cat}>
                    <h3 className="text-sm font-medium text-muted-foreground mb-2">
                      {cat}
                    </h3>
                    <div className="space-y-2">
                      {categoryTemplates.map((template) => (
                        <div
                          key={template.id}
                          className="p-3 rounded-lg border border-border"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="font-medium">{template.name}</span>
                                <Badge
                                  variant="outline"
                                  className={priorityColors[template.defaultPriority]}
                                >
                                  {template.defaultPriority}
                                </Badge>
                              </div>
                              {template.description && (
                                <p className="text-sm text-muted-foreground line-clamp-2">
                                  {template.description}
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => openEditForm(template)}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDelete(template.id)}
                                className="text-destructive hover:text-destructive"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <DialogFooter className="pt-4">
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
