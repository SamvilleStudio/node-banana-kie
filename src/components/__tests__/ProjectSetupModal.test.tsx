import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ProjectSetupModal } from "@/components/ProjectSetupModal";
import { ProviderSettings } from "@/types";

const mockSetUseExternalImageStorage = vi.fn();
const mockUpdateProviderApiKey = vi.fn();
const mockToggleProvider = vi.fn();
const mockSetMaxConcurrentCalls = vi.fn();
const mockUseWorkflowStore = vi.fn();

vi.mock("@/store/workflowStore", () => ({
  useWorkflowStore: (selector?: (state: unknown) => unknown) => {
    if (selector) {
      return mockUseWorkflowStore(selector);
    }
    return mockUseWorkflowStore((s: unknown) => s);
  },
  generateWorkflowId: () => "mock-workflow-id",
}));

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

const defaultProviderSettings: ProviderSettings = {
  providers: {
    gemini: { id: "gemini", name: "Gemini", enabled: true, apiKey: null, apiKeyEnvVar: "GEMINI_API_KEY" },
    openai: { id: "openai", name: "OpenAI", enabled: false, apiKey: null, apiKeyEnvVar: "OPENAI_API_KEY" },
    replicate: { id: "replicate", name: "Replicate", enabled: false, apiKey: null, apiKeyEnvVar: "REPLICATE_API_KEY" },
    fal: { id: "fal", name: "fal.ai", enabled: false, apiKey: null, apiKeyEnvVar: "FAL_API_KEY" },
    kie: { id: "kie", name: "Kie.ai", enabled: false, apiKey: null, apiKeyEnvVar: "KIE_API_KEY" },
    wavespeed: { id: "wavespeed", name: "WaveSpeed", enabled: false, apiKey: null, apiKeyEnvVar: "WAVESPEED_API_KEY" },
  },
};

const createDefaultState = (overrides = {}) => ({
  projectId: null,
  workflowName: "",
  workflowId: "",
  saveDirectoryPath: "",
  useExternalImageStorage: true,
  providerSettings: defaultProviderSettings,
  setUseExternalImageStorage: mockSetUseExternalImageStorage,
  updateProviderApiKey: mockUpdateProviderApiKey,
  toggleProvider: mockToggleProvider,
  maxConcurrentCalls: 3,
  setMaxConcurrentCalls: mockSetMaxConcurrentCalls,
  ...overrides,
});

function defaultFetchMock(url: string, init?: RequestInit) {
  if (url === "/api/env-status") {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        gemini: false,
        openai: false,
        replicate: false,
        fal: false,
        kie: false,
        wavespeed: false,
      }),
    });
  }

  if (url === "/api/auth/openai/status") {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ connected: false }),
    });
  }

  if (url.startsWith("/api/workflow?path=")) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ success: true, exists: true, isDirectory: true }),
    });
  }

  if (url === "/api/projects" && init?.method === "POST") {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ success: true, project: { id: "project-123" } }),
    });
  }

  if (url.startsWith("/api/projects/") && init?.method === "PATCH") {
    const id = url.split("/").pop();
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ success: true, project: { id, name: "updated" } }),
    });
  }

  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ success: true }),
  });
}

async function renderOpenModal(
  mode: "new" | "settings" = "new",
  overrides: Parameters<typeof createDefaultState>[0] = {},
  handlers: Partial<{
    onClose: () => void;
    onSave: (id: string, name: string, directoryPath: string, projectId?: string) => void;
  }> = {}
) {
  mockUseWorkflowStore.mockImplementation((selector) => selector(createDefaultState(overrides)));
  const onClose = handlers.onClose || vi.fn();
  const onSave = handlers.onSave || vi.fn();

  const renderResult = render(
    <ProjectSetupModal
      isOpen={true}
      onClose={onClose}
      onSave={onSave}
      mode={mode}
    />
  );

  await waitFor(() => {
    expect(mockFetch).toHaveBeenCalledWith("/api/env-status");
    expect(mockFetch).toHaveBeenCalledWith("/api/auth/openai/status");
  });

  return { ...renderResult, onClose, onSave };
}

describe("ProjectSetupModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockImplementation(defaultFetchMock);
    mockUseWorkflowStore.mockImplementation((selector) => selector(createDefaultState()));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Visibility", () => {
    it("should not render when isOpen is false", () => {
      render(
        <ProjectSetupModal
          isOpen={false}
          onClose={vi.fn()}
          onSave={vi.fn()}
          mode="new"
        />
      );

      expect(screen.queryByText("New Project")).not.toBeInTheDocument();
      expect(screen.queryByText("Project Settings")).not.toBeInTheDocument();
    });

    it("should render with new title in new mode", async () => {
      await renderOpenModal("new");
      expect(screen.getByText("New Project")).toBeInTheDocument();
    });

    it("should render with settings title in settings mode", async () => {
      await renderOpenModal("settings");
      expect(screen.getByText("Project Settings")).toBeInTheDocument();
    });
  });

  describe("Project Tab", () => {
    it("should render project form with optional directory", async () => {
      await renderOpenModal("new");

      const nameInput = screen.getByPlaceholderText("my-project") as HTMLInputElement;
      const directoryInput = screen.getByPlaceholderText(
        "Leave empty to use database-backed storage"
      ) as HTMLInputElement;

      expect(nameInput.value).toBe("");
      expect(directoryInput.value).toBe("");
      expect(screen.getByText("Project Directory (Optional)")).toBeInTheDocument();
      expect(screen.queryByText("Browse")).not.toBeInTheDocument();
    });

    it("should prefill values in settings mode", async () => {
      await renderOpenModal("settings", {
        workflowName: "My Existing Project",
        saveDirectoryPath: "/path/to/project",
        useExternalImageStorage: false,
      });

      const nameInput = screen.getByPlaceholderText("my-project") as HTMLInputElement;
      const directoryInput = screen.getByPlaceholderText(
        "Leave empty to use database-backed storage"
      ) as HTMLInputElement;

      expect(nameInput.value).toBe("My Existing Project");
      expect(directoryInput.value).toBe("/path/to/project");
    });
  });

  describe("Validation", () => {
    it("should require project name", async () => {
      const { onSave } = await renderOpenModal("new");
      fireEvent.click(screen.getByText("Create"));

      await waitFor(() => {
        expect(screen.getByText("Project name is required")).toBeInTheDocument();
      });
      expect(onSave).not.toHaveBeenCalled();
    });

    it("should reject non-absolute directory path", async () => {
      const { onSave } = await renderOpenModal("new");

      fireEvent.change(screen.getByPlaceholderText("my-project"), {
        target: { value: "My Project" },
      });
      fireEvent.change(screen.getByPlaceholderText("Leave empty to use database-backed storage"), {
        target: { value: "relative/path" },
      });
      fireEvent.click(screen.getByText("Create"));

      await waitFor(() => {
        expect(
          screen.getByText(
            "Project directory must be an absolute path (starting with /, a drive letter, or a UNC path)"
          )
        ).toBeInTheDocument();
      });
      expect(onSave).not.toHaveBeenCalled();
    });

    it("should show error when directory does not exist", async () => {
      mockFetch.mockImplementation((url: string, init?: RequestInit) => {
        if (url.startsWith("/api/workflow?path=")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ success: true, exists: false, isDirectory: false }),
          });
        }
        return defaultFetchMock(url, init);
      });

      const { onSave } = await renderOpenModal("new");
      fireEvent.change(screen.getByPlaceholderText("my-project"), {
        target: { value: "My Project" },
      });
      fireEvent.change(screen.getByPlaceholderText("Leave empty to use database-backed storage"), {
        target: { value: "/missing/path" },
      });
      fireEvent.click(screen.getByText("Create"));

      await waitFor(() => {
        expect(screen.getByText("Project directory does not exist")).toBeInTheDocument();
      });
      expect(onSave).not.toHaveBeenCalled();
    });

    it("should show error when path is not a directory", async () => {
      mockFetch.mockImplementation((url: string, init?: RequestInit) => {
        if (url.startsWith("/api/workflow?path=")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ success: true, exists: true, isDirectory: false }),
          });
        }
        return defaultFetchMock(url, init);
      });

      const { onSave } = await renderOpenModal("new");
      fireEvent.change(screen.getByPlaceholderText("my-project"), {
        target: { value: "My Project" },
      });
      fireEvent.change(screen.getByPlaceholderText("Leave empty to use database-backed storage"), {
        target: { value: "/path/to/file.txt" },
      });
      fireEvent.click(screen.getByText("Create"));

      await waitFor(() => {
        expect(screen.getByText("Project path is not a directory")).toBeInTheDocument();
      });
      expect(onSave).not.toHaveBeenCalled();
    });
  });

  describe("Save Behavior", () => {
    it("should validate directory and call onSave for filesystem mode", async () => {
      const { onSave } = await renderOpenModal("new");
      fireEvent.change(screen.getByPlaceholderText("my-project"), {
        target: { value: "My New Project" },
      });
      fireEvent.change(screen.getByPlaceholderText("Leave empty to use database-backed storage"), {
        target: { value: "/path/to/project" },
      });
      fireEvent.click(screen.getByText("Create"));

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          "/api/workflow?path=%2Fpath%2Fto%2Fproject"
        );
      });
      await waitFor(() => {
        expect(onSave).toHaveBeenCalled();
      });

      const [workflowId, name, directoryPath, projectId] = (onSave as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(workflowId).toBe("mock-workflow-id");
      expect(name).toBe("My New Project");
      expect(directoryPath).toBe("/path/to/project");
      expect(projectId).toBeUndefined();
    });

    it("should create database project when directory is empty", async () => {
      const { onSave } = await renderOpenModal("new");
      fireEvent.change(screen.getByPlaceholderText("my-project"), {
        target: { value: "DB Project" },
      });
      fireEvent.click(screen.getByText("Create"));

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "DB Project" }),
        });
      });
      await waitFor(() => {
        expect(onSave).toHaveBeenCalled();
      });

      const [workflowId, name, directoryPath, projectId] = (onSave as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(workflowId).toBe("mock-workflow-id");
      expect(name).toBe("DB Project");
      expect(directoryPath).toBe("");
      expect(projectId).toBe("project-123");
    });

    it("should show validating state while path validation is in flight", async () => {
      let resolveValidation: ((value: unknown) => void) | undefined;
      mockFetch.mockImplementation((url: string, init?: RequestInit) => {
        if (url.startsWith("/api/workflow?path=")) {
          return new Promise((resolve) => {
            resolveValidation = resolve;
          });
        }
        return defaultFetchMock(url, init);
      });

      await renderOpenModal("new");
      fireEvent.change(screen.getByPlaceholderText("my-project"), {
        target: { value: "Slow Validation" },
      });
      fireEvent.change(screen.getByPlaceholderText("Leave empty to use database-backed storage"), {
        target: { value: "/slow/path" },
      });
      fireEvent.click(screen.getByText("Create"));

      expect(screen.getByText("Validating...")).toBeInTheDocument();

      resolveValidation?.({
        ok: true,
        json: () => Promise.resolve({ success: true, exists: true, isDirectory: true }),
      });
    });

    it("should propagate embed-images toggle setting", async () => {
      await renderOpenModal("new");
      fireEvent.change(screen.getByPlaceholderText("my-project"), {
        target: { value: "My Project" },
      });
      fireEvent.change(screen.getByPlaceholderText("Leave empty to use database-backed storage"), {
        target: { value: "/path/to/project" },
      });

      fireEvent.click(screen.getByRole("checkbox"));
      fireEvent.click(screen.getByText("Create"));

      await waitFor(() => {
        expect(mockSetUseExternalImageStorage).toHaveBeenCalledWith(false);
      });
    });
  });

  describe("Keyboard / Controls", () => {
    it("should call onClose when Cancel is clicked", async () => {
      const onClose = vi.fn();
      await renderOpenModal("new", {}, { onClose });

      fireEvent.click(screen.getByText("Cancel"));
      expect(onClose).toHaveBeenCalled();
    });

    it("should close on Escape", async () => {
      const onClose = vi.fn();
      const { container } = await renderOpenModal("new", {}, { onClose });

      const modalDiv = container.querySelector(".bg-neutral-800");
      fireEvent.keyDown(modalDiv!, { key: "Escape" });
      expect(onClose).toHaveBeenCalled();
    });

    it("should submit on Enter", async () => {
      const onSave = vi.fn();
      const { container } = await renderOpenModal("new", {}, { onSave });
      fireEvent.change(screen.getByPlaceholderText("my-project"), {
        target: { value: "Enter Submit" },
      });

      const modalDiv = container.querySelector(".bg-neutral-800");
      fireEvent.keyDown(modalDiv!, { key: "Enter" });

      await waitFor(() => {
        expect(onSave).toHaveBeenCalled();
      });
    });
  });

  describe("Providers Tab", () => {
    it("should render provider content when Providers tab is selected", async () => {
      await renderOpenModal("settings");
      fireEvent.click(screen.getByText("Providers"));

      await waitFor(() => {
        expect(screen.getByText("Google Gemini")).toBeInTheDocument();
        expect(screen.getByText("OpenAI")).toBeInTheDocument();
      });
    });

    it("should toggle API key visibility", async () => {
      await renderOpenModal("settings");
      fireEvent.click(screen.getByText("Providers"));

      await waitFor(() => {
        expect(screen.getAllByText("Show").length).toBeGreaterThan(0);
      });

      fireEvent.click(screen.getAllByText("Show")[0]);

      await waitFor(() => {
        expect(screen.getByText("Hide")).toBeInTheDocument();
      });
    });

    it("should save provider tab and close modal", async () => {
      const onClose = vi.fn();
      await renderOpenModal("settings", {}, { onClose });
      fireEvent.click(screen.getByText("Providers"));
      await waitFor(() => {
        expect(screen.getByText("Google Gemini")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText("Save"));
      expect(onClose).toHaveBeenCalled();
    });
  });
});
