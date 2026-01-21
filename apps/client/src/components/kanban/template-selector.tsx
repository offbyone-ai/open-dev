import { useState, useEffect } from "react";
import type { TaskTemplate, TaskPriority } from "../../lib/api";
import { taskTemplatesAPI } from "../../lib/api";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Badge } from "../ui/badge";
import { FileText, Plus, Settings } from "lucide-react";

interface TemplateSelectorProps {
  projectId: string;
  onSelectTemplate: (template: TaskTemplate) => void;
  onManageTemplates: () => void;
}

const priorityColors: Record<TaskPriority, string> = {
  low: "bg-green-500/10 text-green-500 border-green-500/20",
  medium: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
  high: "bg-red-500/10 text-red-500 border-red-500/20",
};

export function TemplateSelector({ projectId, onSelectTemplate, onManageTemplates }: TemplateSelectorProps) {
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

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

  const handleSelect = (template: TaskTemplate) => {
    onSelectTemplate(template);
    setOpen(false);
  };

  // Group templates by category
  const groupedTemplates = templates.reduce((acc, template) => {
    const category = template.category || "Uncategorized";
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(template);
    return acc;
  }, {} as Record<string, TaskTemplate[]>);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="gap-2"
      >
        <FileText className="h-4 w-4" />
        Use Template
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span>Select Template</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setOpen(false);
                  onManageTemplates();
                }}
                className="gap-2"
              >
                <Settings className="h-4 w-4" />
                Manage
              </Button>
            </DialogTitle>
          </DialogHeader>

          <div className="overflow-y-auto flex-1 -mx-6 px-6">
            {loading ? (
              <div className="text-center py-8 text-muted-foreground">
                Loading templates...
              </div>
            ) : templates.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-muted-foreground mb-4">No templates yet</p>
                <Button
                  variant="outline"
                  onClick={() => {
                    setOpen(false);
                    onManageTemplates();
                  }}
                  className="gap-2"
                >
                  <Plus className="h-4 w-4" />
                  Create Template
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {Object.entries(groupedTemplates).map(([category, categoryTemplates]) => (
                  <div key={category}>
                    <h3 className="text-sm font-medium text-muted-foreground mb-2">
                      {category}
                    </h3>
                    <div className="space-y-2">
                      {categoryTemplates.map((template) => (
                        <button
                          key={template.id}
                          onClick={() => handleSelect(template)}
                          className="w-full text-left p-3 rounded-lg border border-border hover:border-primary/50 hover:bg-accent/50 transition-colors"
                        >
                          <div className="flex items-center justify-between mb-1">
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
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
