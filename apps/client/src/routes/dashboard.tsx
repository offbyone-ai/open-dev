import { useState, useEffect } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useSession, signOut } from "../lib/auth-client";
import { projectsAPI, aiProvidersAPI, type Project, type AIProvider } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { Select } from "../components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../components/ui/dialog";
import { Badge } from "../components/ui/badge";
import { Plus, LogOut, FolderKanban, Bot, Pencil, Trash2, RefreshCw, Palette } from "lucide-react";
import { ThemeSwitcher } from "../components/theme-switcher";

export function DashboardPage() {
  const navigate = useNavigate();
  const { data: session, isPending } = useSession();
  const [projects, setProjects] = useState<Project[]>([]);
  const [providers, setProviders] = useState<AIProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewProject, setShowNewProject] = useState(false);
  const [showNewProvider, setShowNewProvider] = useState(false);
  const [editingProvider, setEditingProvider] = useState<AIProvider | null>(null);
  const [deletingProvider, setDeletingProvider] = useState<AIProvider | null>(null);
  const [deletingProject, setDeletingProject] = useState<Project | null>(null);
  const [providerStatus, setProviderStatus] = useState<Record<string, "connected" | "error" | "checking">>({});
  const [checkingAll, setCheckingAll] = useState(false);
  const [showThemeSettings, setShowThemeSettings] = useState(false);

  useEffect(() => {
    if (!isPending && !session) {
      navigate({ to: "/login" });
    }
  }, [session, isPending, navigate]);

  useEffect(() => {
    if (session) {
      loadData();
    }
  }, [session]);

  const loadData = async () => {
    try {
      const [projectsData, providersData] = await Promise.all([
        projectsAPI.list(),
        aiProvidersAPI.list(),
      ]);
      setProjects(projectsData);
      setProviders(providersData);
    } catch (err) {
      console.error("Failed to load data:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    navigate({ to: "/" });
  };

  const handleDeleteProvider = async (provider: AIProvider) => {
    try {
      await aiProvidersAPI.delete(provider.id);
      setProviders(providers.filter((p) => p.id !== provider.id));
      setDeletingProvider(null);
    } catch (err) {
      console.error("Failed to delete provider:", err);
    }
  };

  const handleDeleteProject = async (project: Project) => {
    try {
      await projectsAPI.delete(project.id);
      setProjects(projects.filter((p) => p.id !== project.id));
      setDeletingProject(null);
    } catch (err) {
      console.error("Failed to delete project:", err);
    }
  };

  const checkProviderConnection = async (provider: AIProvider) => {
    setProviderStatus((prev) => ({ ...prev, [provider.id]: "checking" }));
    try {
      const result = await aiProvidersAPI.test(provider.baseUrl);
      setProviderStatus((prev) => ({
        ...prev,
        [provider.id]: result.success ? "connected" : "error",
      }));
    } catch {
      setProviderStatus((prev) => ({ ...prev, [provider.id]: "error" }));
    }
  };

  const checkAllProviders = async () => {
    setCheckingAll(true);
    await Promise.all(providers.map(checkProviderConnection));
    setCheckingAll(false);
  };

  // Check provider connections when providers are loaded
  useEffect(() => {
    if (providers.length > 0) {
      checkAllProviders();
    }
  }, [providers.length]);

  if (isPending || loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-xl font-bold">Open Dev</h1>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground mr-2">
              {session?.user?.name || session?.user?.email}
            </span>
            <Button variant="ghost" size="icon" onClick={() => setShowThemeSettings(true)} title="Theme settings">
              <Palette className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={handleSignOut} title="Sign out">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {/* AI Providers Section */}
        <section className="mb-12">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Bot className="h-5 w-5" />
              AI Providers
            </h2>
            <div className="flex gap-2">
              {providers.length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={checkAllProviders}
                  disabled={checkingAll}
                >
                  <RefreshCw className={`h-4 w-4 mr-2 ${checkingAll ? "animate-spin" : ""}`} />
                  Check Status
                </Button>
              )}
              <Button size="sm" onClick={() => setShowNewProvider(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Add Provider
              </Button>
            </div>
          </div>
          {providers.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No AI providers configured. Add one to enable AI planning.
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {providers.map((provider) => {
                const status = providerStatus[provider.id];
                return (
                  <Card key={provider.id}>
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <CardTitle className="text-base">{provider.name}</CardTitle>
                            {status === "checking" && (
                              <Badge variant="secondary">
                                <RefreshCw className="h-3 w-3 mr-1 animate-spin" />
                                Checking
                              </Badge>
                            )}
                            {status === "connected" && (
                              <Badge variant="success">Connected</Badge>
                            )}
                            {status === "error" && (
                              <Badge variant="destructive">Disconnected</Badge>
                            )}
                            {!status && (
                              <Badge variant="warning">Unknown</Badge>
                            )}
                          </div>
                          <CardDescription className="text-xs truncate">
                            {provider.baseUrl}
                          </CardDescription>
                        </div>
                        <div className="flex gap-1 ml-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setEditingProvider(provider)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => setDeletingProvider(provider)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground">
                        Model: {provider.model}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        API Key: {provider.hasApiKey ? "Configured" : "Not set"}
                      </p>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </section>

        {/* Projects Section */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <FolderKanban className="h-5 w-5" />
              Projects
            </h2>
            <Button onClick={() => setShowNewProject(true)}>
              <Plus className="h-4 w-4 mr-2" />
              New Project
            </Button>
          </div>
          {projects.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-muted-foreground mb-4">No projects yet</p>
                <Button onClick={() => setShowNewProject(true)}>
                  Create your first project
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {projects.map((project) => (
                <Card key={project.id} className="h-full hover:border-primary/50 transition-colors">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between">
                      <Link to="/project/$projectId" params={{ projectId: project.id }} className="flex-1 min-w-0">
                        <CardTitle className="hover:text-primary transition-colors cursor-pointer">
                          {project.name}
                        </CardTitle>
                        {project.description && (
                          <CardDescription className="line-clamp-2 mt-1">
                            {project.description}
                          </CardDescription>
                        )}
                      </Link>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive ml-2 flex-shrink-0"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setDeletingProject(project);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <Link to="/project/$projectId" params={{ projectId: project.id }}>
                      <p className="text-xs text-muted-foreground">
                        Created {new Date(project.createdAt).toLocaleDateString()}
                      </p>
                    </Link>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>
      </main>

      {/* New Project Dialog */}
      <NewProjectDialog
        open={showNewProject}
        onClose={() => setShowNewProject(false)}
        providers={providers}
        onCreated={(project) => {
          setProjects([project, ...projects]);
          setShowNewProject(false);
        }}
      />

      {/* New Provider Dialog */}
      <NewProviderDialog
        open={showNewProvider}
        onClose={() => setShowNewProvider(false)}
        onCreated={(provider) => {
          setProviders([provider, ...providers]);
          setShowNewProvider(false);
        }}
      />

      {/* Edit Provider Dialog */}
      <EditProviderDialog
        provider={editingProvider}
        onClose={() => setEditingProvider(null)}
        onUpdated={(updatedProvider) => {
          setProviders(providers.map((p) =>
            p.id === updatedProvider.id ? updatedProvider : p
          ));
          setEditingProvider(null);
        }}
      />

      {/* Delete Provider Confirmation */}
      <Dialog open={!!deletingProvider} onOpenChange={() => setDeletingProvider(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete AI Provider</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{deletingProvider?.name}"? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingProvider(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deletingProvider && handleDeleteProvider(deletingProvider)}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Project Confirmation */}
      <Dialog open={!!deletingProject} onOpenChange={() => setDeletingProject(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Project</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{deletingProject?.name}"? This will permanently delete the project and all its tasks. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingProject(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deletingProject && handleDeleteProject(deletingProject)}
            >
              Delete Project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Theme Settings Dialog */}
      <Dialog open={showThemeSettings} onOpenChange={setShowThemeSettings}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Palette className="h-5 w-5" />
              Theme Settings
            </DialogTitle>
          </DialogHeader>
          <ThemeSwitcher />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function NewProjectDialog({
  open,
  onClose,
  providers,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  providers: AIProvider[];
  onCreated: (project: Project) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [guidelines, setGuidelines] = useState("");
  const [aiProviderId, setAiProviderId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const { id } = await projectsAPI.create({
        name,
        description: description || undefined,
        guidelines: guidelines || undefined,
        aiProviderId: aiProviderId || undefined,
      });
      const project = await projectsAPI.get(id);
      onCreated(project);
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create project");
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setName("");
    setDescription("");
    setGuidelines("");
    setAiProviderId("");
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create New Project</DialogTitle>
          <DialogDescription>
            Create a new project to plan and manage tasks with AI assistance.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-md">
              {error}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="name">Project Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Awesome Project"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">Description (optional)</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this project about?"
              rows={2}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="provider">AI Provider (optional)</Label>
            <Select
              id="provider"
              value={aiProviderId}
              onChange={(e) => setAiProviderId(e.target.value)}
              options={providers.map((p) => ({ value: p.id, label: p.name }))}
              placeholder="Select a provider"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="guidelines">AI Guidelines (optional)</Label>
            <Textarea
              id="guidelines"
              value={guidelines}
              onChange={(e) => setGuidelines(e.target.value)}
              placeholder="Instructions for how the AI should help plan tasks..."
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Creating..." : "Create Project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function NewProviderDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (provider: AIProvider) => void;
}) {
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [models, setModels] = useState<{ id: string; name?: string }[]>([]);
  const [connectionTested, setConnectionTested] = useState(false);
  const [testing, setTesting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const handleTestConnection = async () => {
    if (!baseUrl) {
      setError("Please enter a base URL");
      return;
    }

    setError("");
    setSuccess("");
    setTesting(true);
    setConnectionTested(false);
    setModels([]);
    setModel("");

    try {
      const result = await aiProvidersAPI.test(baseUrl, apiKey || undefined);
      if (result.success) {
        setModels(result.models || []);
        setConnectionTested(true);
        if (result.models && result.models.length > 0) {
          setModel(result.models[0]!.id);
          setSuccess(`Connected! Found ${result.models.length} model(s).`);
        } else {
          setSuccess("Connected! No models found - you can enter a model name manually.");
        }
      } else {
        setError(result.error || "Connection failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection test failed");
    } finally {
      setTesting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!connectionTested) {
      setError("Please test the connection first");
      return;
    }
    if (!model) {
      setError("Please select or enter a model");
      return;
    }

    setError("");
    setLoading(true);

    try {
      const { id } = await aiProvidersAPI.create({
        name,
        baseUrl,
        apiKey: apiKey || undefined,
        model,
      });
      const provider = await aiProvidersAPI.get(id);
      onCreated(provider);
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create provider");
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setName("");
    setBaseUrl("");
    setApiKey("");
    setModel("");
    setModels([]);
    setConnectionTested(false);
    setError("");
    setSuccess("");
  };

  // Reset connection state when URL or key changes
  const handleBaseUrlChange = (value: string) => {
    setBaseUrl(value);
    setConnectionTested(false);
    setModels([]);
    setModel("");
    setSuccess("");
  };

  const handleApiKeyChange = (value: string) => {
    setApiKey(value);
    setConnectionTested(false);
    setModels([]);
    setModel("");
    setSuccess("");
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add AI Provider</DialogTitle>
          <DialogDescription>
            Configure an OpenAI-compatible API endpoint for AI planning.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-md">
              {error}
            </div>
          )}
          {success && (
            <div className="p-3 text-sm text-green-700 bg-green-100 rounded-md">
              {success}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="provider-name">Provider Name</Label>
            <Input
              id="provider-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., OpenAI, Ollama, Claude"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="base-url">Base URL</Label>
            <Input
              id="base-url"
              value={baseUrl}
              onChange={(e) => handleBaseUrlChange(e.target.value)}
              placeholder="https://api.openai.com/v1"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="api-key">API Key (optional)</Label>
            <Input
              id="api-key"
              type="password"
              value={apiKey}
              onChange={(e) => handleApiKeyChange(e.target.value)}
              placeholder="sk-..."
            />
          </div>
          <div>
            <Button
              type="button"
              variant="outline"
              onClick={handleTestConnection}
              disabled={testing || !baseUrl}
              className="w-full"
            >
              {testing ? "Testing Connection..." : "Test Connection"}
            </Button>
          </div>
          {connectionTested && (
            <div className="space-y-2">
              <Label htmlFor="model">Model</Label>
              {models.length > 0 ? (
                <Select
                  id="model"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  options={models.map((m) => ({ value: m.id, label: m.name || m.id }))}
                  placeholder="Select a model"
                />
              ) : (
                <Input
                  id="model"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="Enter model name (e.g., gpt-4)"
                  required
                />
              )}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading || !connectionTested || !model}>
              {loading ? "Adding..." : "Add Provider"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditProviderDialog({
  provider,
  onClose,
  onUpdated,
}: {
  provider: AIProvider | null;
  onClose: () => void;
  onUpdated: (provider: AIProvider) => void;
}) {
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [models, setModels] = useState<{ id: string; name?: string }[]>([]);
  const [connectionTested, setConnectionTested] = useState(false);
  const [testing, setTesting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Initialize form when provider changes
  useEffect(() => {
    if (provider) {
      setName(provider.name);
      setBaseUrl(provider.baseUrl);
      setModel(provider.model);
      setApiKey("");
      setConnectionTested(true); // Assume existing provider is valid
      setModels([{ id: provider.model, name: provider.model }]);
      setError("");
      setSuccess("");
    }
  }, [provider]);

  const handleTestConnection = async () => {
    if (!baseUrl) {
      setError("Please enter a base URL");
      return;
    }

    setError("");
    setSuccess("");
    setTesting(true);
    setConnectionTested(false);
    setModels([]);

    try {
      const result = await aiProvidersAPI.test(baseUrl, apiKey || undefined);
      if (result.success) {
        setModels(result.models || []);
        setConnectionTested(true);
        if (result.models && result.models.length > 0) {
          if (!result.models.find(m => m.id === model)) {
            setModel(result.models[0]!.id);
          }
          setSuccess(`Connected! Found ${result.models.length} model(s).`);
        } else {
          setSuccess("Connected! No models found - you can enter a model name manually.");
        }
      } else {
        setError(result.error || "Connection failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection test failed");
    } finally {
      setTesting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!provider) return;
    if (!connectionTested) {
      setError("Please test the connection first");
      return;
    }
    if (!model) {
      setError("Please select or enter a model");
      return;
    }

    setError("");
    setLoading(true);

    try {
      const updateData: { name?: string; baseUrl?: string; apiKey?: string; model?: string } = {
        name,
        baseUrl,
        model,
      };
      if (apiKey) {
        updateData.apiKey = apiKey;
      }
      await aiProvidersAPI.update(provider.id, updateData);
      const updatedProvider = await aiProvidersAPI.get(provider.id);
      onUpdated(updatedProvider);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update provider");
    } finally {
      setLoading(false);
    }
  };

  const handleBaseUrlChange = (value: string) => {
    setBaseUrl(value);
    setConnectionTested(false);
    setModels([]);
    setSuccess("");
  };

  const handleApiKeyChange = (value: string) => {
    setApiKey(value);
    setConnectionTested(false);
    setModels([]);
    setSuccess("");
  };

  return (
    <Dialog open={!!provider} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit AI Provider</DialogTitle>
          <DialogDescription>
            Update your AI provider configuration.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-md">
              {error}
            </div>
          )}
          {success && (
            <div className="p-3 text-sm text-green-700 bg-green-100 rounded-md">
              {success}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="edit-provider-name">Provider Name</Label>
            <Input
              id="edit-provider-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., OpenAI, Ollama, Claude"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-base-url">Base URL</Label>
            <Input
              id="edit-base-url"
              value={baseUrl}
              onChange={(e) => handleBaseUrlChange(e.target.value)}
              placeholder="https://api.openai.com/v1"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-api-key">API Key (leave empty to keep current)</Label>
            <Input
              id="edit-api-key"
              type="password"
              value={apiKey}
              onChange={(e) => handleApiKeyChange(e.target.value)}
              placeholder="sk-..."
            />
          </div>
          <div>
            <Button
              type="button"
              variant="outline"
              onClick={handleTestConnection}
              disabled={testing || !baseUrl}
              className="w-full"
            >
              {testing ? "Testing Connection..." : "Test Connection"}
            </Button>
          </div>
          {connectionTested && (
            <div className="space-y-2">
              <Label htmlFor="edit-model">Model</Label>
              {models.length > 0 ? (
                <Select
                  id="edit-model"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  options={models.map((m) => ({ value: m.id, label: m.name || m.id }))}
                  placeholder="Select a model"
                />
              ) : (
                <Input
                  id="edit-model"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="Enter model name (e.g., gpt-4)"
                  required
                />
              )}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading || !connectionTested || !model}>
              {loading ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
