import { create } from "zustand";
import { useShallow } from "zustand/shallow";
import {
  Connection,
  EdgeChange,
  NodeChange,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  XYPosition,
} from "@xyflow/react";
import {
  WorkflowNode,
  WorkflowEdge,
  NodeType,
  ImageInputNodeData,
  AudioInputNodeData,
  AnnotationNodeData,
  PromptNodeData,
  PromptConstructorNodeData,
  KlingPromptNodeData,
  NanoBananaNodeData,
  NanoBananaEditNodeData,
  GenerateVideoNodeData,
  VeoReferenceVideoNodeData,
  VeoExtendVideoNodeData,
  Veo1080pVideoNodeData,
  Veo4kVideoNodeData,
  SoraStoryboardNodeData,
  LLMGenerateNodeData,
  SplitGridNodeData,
  OutputNodeData,
  WorkflowNodeData,
  ImageHistoryItem,
  NodeGroup,
  GroupColor,
  ProviderType,
  ProviderSettings,
  RecentModel,
  OutputGalleryNodeData,
  VideoStitchNodeData,
  EaseCurveNodeData,
} from "@/types";
import { useToast } from "@/components/Toast";
import { calculateGenerationCost } from "@/utils/costCalculator";
import { logger } from "@/utils/logger";
import { externalizeWorkflowImages, hydrateWorkflowImages } from "@/utils/imageStorage";
import { getProjectGenerationsPublicPath, getProjectOutputsPublicPath } from "@/lib/storagePaths";
import { EditOperation, applyEditOperations as executeEditOps } from "@/lib/chat/editOperations";
import {
  loadSaveConfigs,
  saveSaveConfig,
  loadWorkflowCostData,
  saveWorkflowCostData,
  getProviderSettings,
  saveProviderSettings,
  defaultProviderSettings,
  getRecentModels,
  saveRecentModels,
  MAX_RECENT_MODELS,
  generateWorkflowId,
} from "./utils/localStorage";
import {
  createDefaultNodeData,
  defaultNodeDimensions,
  GROUP_COLORS,
  GROUP_COLOR_ORDER,
} from "./utils/nodeDefaults";

export type EdgeStyle = "angular" | "curved";

// Workflow file format
export interface WorkflowFile {
  version: 1;
  id?: string;  // Optional for backward compatibility with old/shared workflows
  name: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  edgeStyle: EdgeStyle;
  groups?: Record<string, NodeGroup>;  // Optional for backward compatibility
}

// Clipboard data structure for copy/paste
interface ClipboardData {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

interface WorkflowStore {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  edgeStyle: EdgeStyle;
  clipboard: ClipboardData | null;
  groups: Record<string, NodeGroup>;

  // Settings
  setEdgeStyle: (style: EdgeStyle) => void;

  // Node operations
  addNode: (type: NodeType, position: XYPosition, initialData?: Partial<WorkflowNodeData>) => string;
  updateNodeData: (nodeId: string, data: Partial<WorkflowNodeData>) => void;
  removeNode: (nodeId: string) => void;
  onNodesChange: (changes: NodeChange<WorkflowNode>[]) => void;

  // Edge operations
  onEdgesChange: (changes: EdgeChange<WorkflowEdge>[]) => void;
  onConnect: (connection: Connection) => void;
  addEdgeWithType: (connection: Connection, edgeType: string) => void;
  removeEdge: (edgeId: string) => void;
  toggleEdgePause: (edgeId: string) => void;

  // Copy/Paste operations
  copySelectedNodes: () => void;
  pasteNodes: (offset?: XYPosition) => void;
  clearClipboard: () => void;

  // Group operations
  createGroup: (nodeIds: string[]) => string;
  deleteGroup: (groupId: string) => void;
  addNodesToGroup: (nodeIds: string[], groupId: string) => void;
  removeNodesFromGroup: (nodeIds: string[]) => void;
  updateGroup: (groupId: string, updates: Partial<NodeGroup>) => void;
  toggleGroupLock: (groupId: string) => void;
  moveGroupNodes: (groupId: string, delta: { x: number; y: number }) => void;
  setNodeGroupId: (nodeId: string, groupId: string | undefined) => void;

  // UI State
  openModalCount: number;
  isModalOpen: boolean;
  showQuickstart: boolean;
  incrementModalCount: () => void;
  decrementModalCount: () => void;
  setShowQuickstart: (show: boolean) => void;

  // Execution
  isRunning: boolean;
  currentNodeIds: string[];  // Changed from currentNodeId for parallel execution
  pausedAtNodeId: string | null;
  maxConcurrentCalls: number;  // Configurable concurrency limit (1-10)
  _abortController: AbortController | null;  // Internal: for cancellation
  executeWorkflow: (startFromNodeId?: string) => Promise<void>;
  regenerateNode: (nodeId: string) => Promise<void>;
  stopWorkflow: () => void;
  setMaxConcurrentCalls: (value: number) => void;

  // Save/Load
  saveWorkflow: (name?: string) => void;
  loadWorkflow: (workflow: WorkflowFile, workflowPath?: string, options?: { preserveSnapshot?: boolean }) => Promise<void>;
  clearWorkflow: () => void;

  // Helpers
  getNodeById: (id: string) => WorkflowNode | undefined;
  getConnectedInputs: (nodeId: string) => { images: string[]; videos: string[]; audio: string[]; text: string | null; taskId: string | null; dynamicInputs: Record<string, unknown>; easeCurve: { bezierHandles: [number, number, number, number]; easingPreset: string | null } | null };
  validateWorkflow: () => { valid: boolean; errors: string[] };

  // Global Image History
  globalImageHistory: ImageHistoryItem[];
  addToGlobalHistory: (item: Omit<ImageHistoryItem, "id">) => void;
  clearGlobalHistory: () => void;

  // Auto-save state
  projectId: string | null;
  workflowId: string | null;
  workflowName: string | null;
  saveDirectoryPath: string | null;
  generationsPath: string | null;
  lastSavedAt: number | null;
  hasUnsavedChanges: boolean;
  autoSaveEnabled: boolean;
  isSaving: boolean;
  useExternalImageStorage: boolean;  // Store images as separate files vs embedded base64
  imageRefBasePath: string | null;  // Directory from which current imageRefs are valid

  // Auto-save actions
  setWorkflowMetadata: (
    id: string,
    name: string,
    path: string,
    generationsPath?: string | null,
    projectId?: string | null
  ) => void;
  setWorkflowName: (name: string) => void;
  setGenerationsPath: (path: string | null) => void;
  setAutoSaveEnabled: (enabled: boolean) => void;
  setUseExternalImageStorage: (enabled: boolean) => void;
  markAsUnsaved: () => void;
  saveToFile: () => Promise<boolean>;
  initializeAutoSave: () => void;
  cleanupAutoSave: () => void;

  // Cost tracking state
  incurredCost: number;

  // Cost tracking actions
  addIncurredCost: (cost: number) => void;
  resetIncurredCost: () => void;
  loadIncurredCost: (workflowId: string) => void;
  saveIncurredCost: () => void;

  // Provider settings state
  providerSettings: ProviderSettings;

  // Provider settings actions
  updateProviderSettings: (settings: ProviderSettings) => void;
  updateProviderApiKey: (providerId: ProviderType, apiKey: string | null) => void;
  toggleProvider: (providerId: ProviderType, enabled: boolean) => void;

  // Model search dialog state
  modelSearchOpen: boolean;
  modelSearchProvider: ProviderType | null;

  // Model search dialog actions
  setModelSearchOpen: (open: boolean, provider?: ProviderType | null) => void;

  // Recent models state
  recentModels: RecentModel[];

  // Recent models actions
  trackModelUsage: (model: { provider: ProviderType; modelId: string; displayName: string }) => void;

  // Comment navigation state
  viewedCommentNodeIds: Set<string>;
  navigationTarget: { nodeId: string; timestamp: number } | null;
  focusedCommentNodeId: string | null;

  // Comment navigation actions
  getNodesWithComments: () => WorkflowNode[];
  getUnviewedCommentCount: () => number;
  markCommentViewed: (nodeId: string) => void;
  setNavigationTarget: (nodeId: string | null) => void;
  setFocusedCommentNodeId: (nodeId: string | null) => void;
  resetViewedComments: () => void;

  // AI change snapshot state
  previousWorkflowSnapshot: {
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
    groups: Record<string, NodeGroup>;
    edgeStyle: EdgeStyle;
  } | null;
  manualChangeCount: number;

  // AI change snapshot actions
  captureSnapshot: () => void;
  revertToSnapshot: () => void;
  clearSnapshot: () => void;
  incrementManualChangeCount: () => void;
  applyEditOperations: (operations: EditOperation[]) => { applied: number; skipped: string[] };
}

let nodeIdCounter = 0;
let groupIdCounter = 0;
let autoSaveIntervalId: ReturnType<typeof setInterval> | null = null;

// Track pending save-generation syncs to ensure IDs are resolved before workflow save
const pendingImageSyncs = new Map<string, Promise<void>>();

// Helper to save a generation and sync the history ID
// Returns immediately but tracks the async operation for later awaiting
function trackSaveGeneration(
  genPath: string | null,
  content: { image?: string; video?: string },
  prompt: string | null,
  tempId: string,
  nodeId: string,
  historyType: 'image' | 'video',
  get: () => WorkflowStore,
  updateNodeData: (nodeId: string, data: Partial<WorkflowNodeData>) => void
): void {
  const { projectId, workflowId } = get();
  if (!genPath && !projectId) {
    return;
  }

  const payload: Record<string, unknown> = {
    image: content.image,
    video: content.video,
    prompt,
    imageId: tempId,
    projectId: projectId ?? undefined,
    workflowId: workflowId ?? undefined,
    nodeId,
  };

  if (genPath) {
    payload.directoryPath = genPath;
  }

  const syncPromise = fetch("/api/save-generation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
    .then((res) => res.json())
    .then((saveResult) => {
      // Update history with actual saved ID for carousel loading
      if (saveResult.success && saveResult.imageId && saveResult.imageId !== tempId) {
        const currentNode = get().nodes.find((n) => n.id === nodeId);
        if (currentNode) {
          if (historyType === 'image') {
            const currentData = currentNode.data as NanoBananaNodeData;
            const updatedHistory = [...(currentData.imageHistory || [])];
            const entryIndex = updatedHistory.findIndex((h) => h.id === tempId);
            if (entryIndex !== -1) {
              updatedHistory[entryIndex] = { ...updatedHistory[entryIndex], id: saveResult.imageId };
              updateNodeData(nodeId, { imageHistory: updatedHistory });
            }
          } else {
            const currentData = currentNode.data as GenerateVideoNodeData;
            const updatedHistory = [...(currentData.videoHistory || [])];
            const entryIndex = updatedHistory.findIndex((h) => h.id === tempId);
            if (entryIndex !== -1) {
              updatedHistory[entryIndex] = { ...updatedHistory[entryIndex], id: saveResult.imageId };
              updateNodeData(nodeId, { videoHistory: updatedHistory });
            }
          }
        }
      }
    })
    .catch((err) => {
      console.error(`Failed to save ${historyType === 'video' ? 'video' : ''} generation:`, err);
    })
    .finally(() => {
      // Remove from pending syncs when done (success or failure)
      pendingImageSyncs.delete(tempId);
    });

  pendingImageSyncs.set(tempId, syncPromise);
}

// Wait for all pending image syncs to complete (with timeout to prevent infinite hangs)
async function waitForPendingImageSyncs(timeout: number = 60000): Promise<void> {
  if (pendingImageSyncs.size === 0) return;

  let timeoutId: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<void>((resolve) => {
    timeoutId = setTimeout(() => {
      console.warn(`Pending image syncs timed out after ${timeout}ms, continuing with save`);
      resolve();
    }, timeout);
  });

  try {
    await Promise.race([
      Promise.all(pendingImageSyncs.values()),
      timeoutPromise,
    ]);
  } finally {
    clearTimeout(timeoutId!);
  }
}

// Concurrency settings
export const CONCURRENCY_SETTINGS_KEY = "node-banana-concurrency-limit";
const DEFAULT_MAX_CONCURRENT_CALLS = 3;

// Load/save concurrency setting from localStorage
const loadConcurrencySetting = (): number => {
  if (typeof window === "undefined") return DEFAULT_MAX_CONCURRENT_CALLS;
  const stored = localStorage.getItem(CONCURRENCY_SETTINGS_KEY);
  if (stored) {
    const parsed = parseInt(stored, 10);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= 10) {
      return parsed;
    }
  }
  return DEFAULT_MAX_CONCURRENT_CALLS;
};

const saveConcurrencySetting = (value: number): void => {
  if (typeof window === "undefined") return;
  localStorage.setItem(CONCURRENCY_SETTINGS_KEY, String(value));
};

// Level grouping for parallel execution
export interface LevelGroup {
  level: number;
  nodeIds: string[];
}

/**
 * Groups nodes by dependency level using Kahn's algorithm variant.
 * Nodes at the same level can be executed in parallel.
 * Level 0 = nodes with no incoming edges (roots)
 * Level N = nodes whose dependencies are all at levels < N
 */
function groupNodesByLevel(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[]
): LevelGroup[] {
  // Calculate in-degree for each node
  const inDegree = new Map<string, number>();
  const adjList = new Map<string, string[]>();

  nodes.forEach((n) => {
    inDegree.set(n.id, 0);
    adjList.set(n.id, []);
  });

  edges.forEach((e) => {
    inDegree.set(e.target, (inDegree.get(e.target) || 0) + 1);
    adjList.get(e.source)?.push(e.target);
  });

  // BFS with level tracking (Kahn's algorithm variant)
  const levels: LevelGroup[] = [];
  let currentLevel = nodes
    .filter((n) => inDegree.get(n.id) === 0)
    .map((n) => n.id);

  let levelNum = 0;
  while (currentLevel.length > 0) {
    levels.push({ level: levelNum, nodeIds: [...currentLevel] });

    const nextLevel: string[] = [];
    for (const nodeId of currentLevel) {
      for (const child of adjList.get(nodeId) || []) {
        const newDegree = (inDegree.get(child) || 1) - 1;
        inDegree.set(child, newDegree);
        if (newDegree === 0) {
          nextLevel.push(child);
        }
      }
    }

    currentLevel = nextLevel;
    levelNum++;
  }

  return levels;
}

/**
 * Chunk an array into smaller arrays of specified size
 */
function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

// Clear all imageRefs from nodes (used when saving to a different directory)
/** Revoke a blob URL if the value is one, to free the underlying memory. */
function revokeBlobUrl(url: string | null | undefined): void {
  if (url && url.startsWith('blob:')) {
    try { URL.revokeObjectURL(url); } catch { /* ignore */ }
  }
}

function clearNodeImageRefs(nodes: WorkflowNode[]): WorkflowNode[] {
  return nodes.map(node => {
    const data = { ...node.data } as Record<string, unknown>;

    // Revoke blob URLs for video outputs before clearing
    revokeBlobUrl(data.outputVideo as string | undefined);

    // Clear all ref fields regardless of node type
    delete data.imageRef;
    delete data.sourceImageRef;
    delete data.outputImageRef;
    delete data.inputImageRefs;

    return { ...node, data: data as WorkflowNodeData } as WorkflowNode;
  });
}

// Re-export for backward compatibility
export { generateWorkflowId, saveGenerateImageDefaults, saveNanoBananaDefaults } from "./utils/localStorage";
export { GROUP_COLORS } from "./utils/nodeDefaults";

export const useWorkflowStore = create<WorkflowStore>((set, get) => ({
  nodes: [],
  edges: [],
  edgeStyle: "curved" as EdgeStyle,
  clipboard: null,
  groups: {},
  openModalCount: 0,
  isModalOpen: false,
  showQuickstart: true,
  isRunning: false,
  currentNodeIds: [],  // Changed from currentNodeId for parallel execution
  pausedAtNodeId: null,
  maxConcurrentCalls: loadConcurrencySetting(),  // Default 3, configurable 1-10
  _abortController: null,  // Internal: for cancellation
  globalImageHistory: [],

  // Auto-save initial state
  projectId: null,
  workflowId: null,
  workflowName: null,
  saveDirectoryPath: null,
  generationsPath: null,
  lastSavedAt: null,
  hasUnsavedChanges: false,
  autoSaveEnabled: true,
  isSaving: false,
  useExternalImageStorage: true,  // Default: store images as separate files
  imageRefBasePath: null,  // Directory from which current imageRefs are valid

  // Cost tracking initial state
  incurredCost: 0,

  // Provider settings initial state
  providerSettings: getProviderSettings(),

  // Model search dialog initial state
  modelSearchOpen: false,
  modelSearchProvider: null,

  // Recent models initial state
  recentModels: getRecentModels(),

  // Comment navigation initial state
  viewedCommentNodeIds: new Set<string>(),
  navigationTarget: null,
  focusedCommentNodeId: null,

  // AI change snapshot initial state
  previousWorkflowSnapshot: null,
  manualChangeCount: 0,

  setEdgeStyle: (style: EdgeStyle) => {
    set({ edgeStyle: style });
  },

  incrementModalCount: () => {
    set((state) => {
      const newCount = state.openModalCount + 1;
      return { openModalCount: newCount, isModalOpen: newCount > 0 };
    });
  },

  decrementModalCount: () => {
    set((state) => {
      const newCount = Math.max(0, state.openModalCount - 1);
      return { openModalCount: newCount, isModalOpen: newCount > 0 };
    });
  },

  setShowQuickstart: (show: boolean) => {
    set({ showQuickstart: show });
  },

  addNode: (type: NodeType, position: XYPosition, initialData?: Partial<WorkflowNodeData>) => {
    const id = `${type}-${++nodeIdCounter}`;

    const { width, height } = defaultNodeDimensions[type];

    // Merge default data with initialData if provided
    const defaultData = createDefaultNodeData(type);
    const nodeData = initialData
      ? ({ ...defaultData, ...initialData } as WorkflowNodeData)
      : defaultData;

    const newNode: WorkflowNode = {
      id,
      type,
      position,
      data: nodeData,
      style: { width, height },
    };

    set((state) => ({
      nodes: [...state.nodes, newNode],
      hasUnsavedChanges: true,
    }));

    get().incrementManualChangeCount();

    return id;
  },

  updateNodeData: (nodeId: string, data: Partial<WorkflowNodeData>) => {
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === nodeId
          ? { ...node, data: { ...node.data, ...data } as WorkflowNodeData }
          : node
      ) as WorkflowNode[],
      hasUnsavedChanges: true,
    }));
  },

  removeNode: (nodeId: string) => {
    set((state) => ({
      nodes: state.nodes.filter((node) => node.id !== nodeId),
      edges: state.edges.filter(
        (edge) => edge.source !== nodeId && edge.target !== nodeId
      ),
      hasUnsavedChanges: true,
    }));
    get().incrementManualChangeCount();
  },

  onNodesChange: (changes: NodeChange<WorkflowNode>[]) => {
    // Only mark as unsaved for meaningful changes (not selection changes)
    const hasMeaningfulChange = changes.some(
      (c) => c.type !== "select" && c.type !== "dimensions"
    );
    // Track manual changes only for remove operations (not position/selection/dimensions)
    const hasRemoveChange = changes.some((c) => c.type === "remove");

    set((state) => ({
      nodes: applyNodeChanges(changes, state.nodes),
      ...(hasMeaningfulChange ? { hasUnsavedChanges: true } : {}),
    }));

    if (hasRemoveChange) {
      get().incrementManualChangeCount();
    }
  },

  onEdgesChange: (changes: EdgeChange<WorkflowEdge>[]) => {
    // Only mark as unsaved for meaningful changes (not selection changes)
    const hasMeaningfulChange = changes.some((c) => c.type !== "select");
    // Track manual changes only for remove operations (not selection)
    const hasRemoveChange = changes.some((c) => c.type === "remove");

    set((state) => ({
      edges: applyEdgeChanges(changes, state.edges),
      ...(hasMeaningfulChange ? { hasUnsavedChanges: true } : {}),
    }));

    if (hasRemoveChange) {
      get().incrementManualChangeCount();
    }
  },

  onConnect: (connection: Connection) => {
    set((state) => ({
      edges: addEdge(
        {
          ...connection,
          id: `edge-${connection.source}-${connection.target}-${connection.sourceHandle || "default"}-${connection.targetHandle || "default"}`,
          data: { createdAt: Date.now() },
        },
        state.edges
      ),
      hasUnsavedChanges: true,
    }));
    get().incrementManualChangeCount();
  },

  addEdgeWithType: (connection: Connection, edgeType: string) => {
    set((state) => ({
      edges: addEdge(
        {
          ...connection,
          id: `edge-${connection.source}-${connection.target}-${connection.sourceHandle || "default"}-${connection.targetHandle || "default"}`,
          type: edgeType,
          data: { createdAt: Date.now() },
        },
        state.edges
      ),
      hasUnsavedChanges: true,
    }));
  },

  removeEdge: (edgeId: string) => {
    set((state) => ({
      edges: state.edges.filter((edge) => edge.id !== edgeId),
      hasUnsavedChanges: true,
    }));
    get().incrementManualChangeCount();
  },

  toggleEdgePause: (edgeId: string) => {
    set((state) => ({
      edges: state.edges.map((edge) =>
        edge.id === edgeId
          ? { ...edge, data: { ...edge.data, hasPause: !edge.data?.hasPause } }
          : edge
      ),
      hasUnsavedChanges: true,
    }));
  },

  copySelectedNodes: () => {
    const { nodes, edges } = get();
    const selectedNodes = nodes.filter((node) => node.selected);

    if (selectedNodes.length === 0) return;

    const selectedNodeIds = new Set(selectedNodes.map((n) => n.id));

    // Copy edges that connect selected nodes to each other
    const connectedEdges = edges.filter(
      (edge) => selectedNodeIds.has(edge.source) && selectedNodeIds.has(edge.target)
    );

    // Deep clone the nodes and edges to avoid reference issues
    const clonedNodes = JSON.parse(JSON.stringify(selectedNodes)) as WorkflowNode[];
    const clonedEdges = JSON.parse(JSON.stringify(connectedEdges)) as WorkflowEdge[];

    set({ clipboard: { nodes: clonedNodes, edges: clonedEdges } });
  },

  pasteNodes: (offset: XYPosition = { x: 50, y: 50 }) => {
    const { clipboard, nodes, edges } = get();

    if (!clipboard || clipboard.nodes.length === 0) return;

    // Create a mapping from old node IDs to new node IDs
    const idMapping = new Map<string, string>();

    // Generate new IDs for all pasted nodes
    clipboard.nodes.forEach((node) => {
      const newId = `${node.type}-${++nodeIdCounter}`;
      idMapping.set(node.id, newId);
    });

    // Create new nodes with updated IDs and offset positions
    const newNodes: WorkflowNode[] = clipboard.nodes.map((node) => ({
      ...node,
      id: idMapping.get(node.id)!,
      position: {
        x: node.position.x + offset.x,
        y: node.position.y + offset.y,
      },
      selected: true, // Select newly pasted nodes
      data: { ...node.data }, // Deep copy data
    }));

    // Create new edges with updated source/target IDs
    const newEdges: WorkflowEdge[] = clipboard.edges.map((edge) => ({
      ...edge,
      id: `edge-${idMapping.get(edge.source)}-${idMapping.get(edge.target)}-${edge.sourceHandle || "default"}-${edge.targetHandle || "default"}`,
      source: idMapping.get(edge.source)!,
      target: idMapping.get(edge.target)!,
    }));

    // Deselect existing nodes and add new ones
    const updatedNodes = nodes.map((node) => ({
      ...node,
      selected: false,
    }));

    set({
      nodes: [...updatedNodes, ...newNodes] as WorkflowNode[],
      edges: [...edges, ...newEdges],
      hasUnsavedChanges: true,
    });
  },

  clearClipboard: () => {
    set({ clipboard: null });
  },

  // Group operations
  createGroup: (nodeIds: string[]) => {
    const { nodes, groups } = get();

    if (nodeIds.length === 0) return "";

    // Get the nodes to group
    const nodesToGroup = nodes.filter((n) => nodeIds.includes(n.id));
    if (nodesToGroup.length === 0) return "";

    // Calculate bounding box of selected nodes
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodesToGroup.forEach((node) => {
      // Use measured dimensions (actual rendered size) first, then style, then type-specific defaults
      const defaults = defaultNodeDimensions[node.type as NodeType] || { width: 300, height: 280 };
      const width = node.measured?.width || (node.style?.width as number) || defaults.width;
      const height = node.measured?.height || (node.style?.height as number) || defaults.height;

      minX = Math.min(minX, node.position.x);
      minY = Math.min(minY, node.position.y);
      maxX = Math.max(maxX, node.position.x + width);
      maxY = Math.max(maxY, node.position.y + height);
    });

    // Add padding around nodes
    const padding = 20;
    const headerHeight = 32; // Match HEADER_HEIGHT in GroupsOverlay

    // Find next available color
    const usedColors = new Set(Object.values(groups).map((g) => g.color));
    let color: GroupColor = "neutral";
    for (const c of GROUP_COLOR_ORDER) {
      if (!usedColors.has(c)) {
        color = c;
        break;
      }
    }

    // Generate ID and name
    const id = `group-${++groupIdCounter}`;
    const groupNumber = Object.keys(groups).length + 1;
    const name = `Group ${groupNumber}`;

    const newGroup: NodeGroup = {
      id,
      name,
      color,
      position: {
        x: minX - padding,
        y: minY - padding - headerHeight
      },
      size: {
        width: maxX - minX + padding * 2,
        height: maxY - minY + padding * 2 + headerHeight,
      },
    };

    // Update nodes with groupId and add group
    set((state) => ({
      nodes: state.nodes.map((node) =>
        nodeIds.includes(node.id) ? { ...node, groupId: id } : node
      ) as WorkflowNode[],
      groups: { ...state.groups, [id]: newGroup },
      hasUnsavedChanges: true,
    }));

    return id;
  },

  deleteGroup: (groupId: string) => {
    set((state) => {
      const { [groupId]: _, ...remainingGroups } = state.groups;
      return {
        nodes: state.nodes.map((node) =>
          node.groupId === groupId ? { ...node, groupId: undefined } : node
        ) as WorkflowNode[],
        groups: remainingGroups,
        hasUnsavedChanges: true,
      };
    });
  },

  addNodesToGroup: (nodeIds: string[], groupId: string) => {
    set((state) => ({
      nodes: state.nodes.map((node) =>
        nodeIds.includes(node.id) ? { ...node, groupId } : node
      ) as WorkflowNode[],
      hasUnsavedChanges: true,
    }));
  },

  removeNodesFromGroup: (nodeIds: string[]) => {
    set((state) => ({
      nodes: state.nodes.map((node) =>
        nodeIds.includes(node.id) ? { ...node, groupId: undefined } : node
      ) as WorkflowNode[],
      hasUnsavedChanges: true,
    }));
  },

  updateGroup: (groupId: string, updates: Partial<NodeGroup>) => {
    set((state) => ({
      groups: {
        ...state.groups,
        [groupId]: { ...state.groups[groupId], ...updates },
      },
      hasUnsavedChanges: true,
    }));
  },

  toggleGroupLock: (groupId: string) => {
    set((state) => ({
      groups: {
        ...state.groups,
        [groupId]: {
          ...state.groups[groupId],
          locked: !state.groups[groupId].locked,
        },
      },
      hasUnsavedChanges: true,
    }));
  },

  moveGroupNodes: (groupId: string, delta: { x: number; y: number }) => {
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.groupId === groupId
          ? {
              ...node,
              position: {
                x: node.position.x + delta.x,
                y: node.position.y + delta.y,
              },
            }
          : node
      ) as WorkflowNode[],
      hasUnsavedChanges: true,
    }));
  },

  setNodeGroupId: (nodeId: string, groupId: string | undefined) => {
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === nodeId ? { ...node, groupId } : node
      ) as WorkflowNode[],
      hasUnsavedChanges: true,
    }));
  },

  getNodeById: (id: string) => {
    return get().nodes.find((node) => node.id === id);
  },

  getConnectedInputs: (nodeId: string) => {
    const { edges, nodes } = get();
    const images: string[] = [];
    const videos: string[] = [];
    const audio: string[] = [];
    let text: string | null = null;
    let taskId: string | null = null;
    const dynamicInputs: Record<string, unknown> = {};

    // Get the target node to check for inputSchema
    const targetNode = nodes.find((n) => n.id === nodeId);
    const inputSchema = (targetNode?.data as { inputSchema?: Array<{ name: string; type: string }> })?.inputSchema;

    // Build mapping from normalized handle IDs to schema names if schema exists
    // Handles use normalized IDs ("image", "image-0", "text", "text-0")
    // but API needs schema names ("image_url", "first_frame", "prompt", etc.)
    const handleToSchemaName: Record<string, string> = {};
    if (inputSchema && inputSchema.length > 0) {
      const imageInputs = inputSchema.filter(i => i.type === "image");
      const textInputs = inputSchema.filter(i => i.type === "text");

      // Map image handles to schema names
      // Always use indexed IDs (image-0, image-1) to match node component
      // Also map legacy ID ("image") for first input for backward compatibility
      imageInputs.forEach((input, index) => {
        handleToSchemaName[`image-${index}`] = input.name;
        if (index === 0) {
          handleToSchemaName["image"] = input.name;
        }
      });

      // Map text handles to schema names
      // Always use indexed IDs (text-0, text-1) to match node component
      // Also map legacy ID ("text") for first input for backward compatibility
      textInputs.forEach((input, index) => {
        handleToSchemaName[`text-${index}`] = input.name;
        if (index === 0) {
          handleToSchemaName["text"] = input.name;
        }
      });
    }

    // Helper to determine if a handle ID is an image type
    const isImageHandle = (handleId: string | null | undefined): boolean => {
      if (!handleId) return false;
      return handleId === "image" || handleId.startsWith("image-") || handleId.includes("frame");
    };

    // Helper to determine if a handle ID is a text type
    const isTextHandle = (handleId: string | null | undefined): boolean => {
      if (!handleId) return false;
      return handleId === "text" || handleId.startsWith("text-") || handleId.includes("prompt") || handleId === "taskId";
    };

    // Helper to extract output from source node
    const getSourceOutput = (sourceNode: WorkflowNode, sourceHandle?: string | null): { type: "image" | "text" | "video" | "audio"; value: string | null } => {
      if (sourceNode.type === "imageInput") {
        return { type: "image", value: (sourceNode.data as ImageInputNodeData).image };
      } else if (sourceNode.type === "audioInput") {
        return { type: "audio", value: (sourceNode.data as AudioInputNodeData).audioFile };
      } else if (sourceNode.type === "annotation") {
        return { type: "image", value: (sourceNode.data as AnnotationNodeData).outputImage };
      } else if (sourceNode.type === "nanoBanana") {
        return { type: "image", value: (sourceNode.data as NanoBananaNodeData).outputImage };
      } else if (sourceNode.type === "nanoBananaEdit") {
        return { type: "image", value: (sourceNode.data as NanoBananaEditNodeData).outputImage };
      } else if (sourceNode.type === "generateVideo") {
        const videoData = sourceNode.data as GenerateVideoNodeData;
        if (sourceHandle === "taskId") {
          return { type: "text", value: videoData.outputTaskId || null };
        }
        return { type: "video", value: videoData.outputVideo };
      } else if (sourceNode.type === "veoReferenceVideo") {
        const veoData = sourceNode.data as { outputVideo: string | null; outputTaskId?: string | null };
        if (sourceHandle === "taskId") {
          return { type: "text", value: veoData.outputTaskId || null };
        }
        return { type: "video", value: veoData.outputVideo };
      } else if (sourceNode.type === "veoExtendVideo" || sourceNode.type === "veo1080pVideo" || sourceNode.type === "veo4kVideo") {
        const veoData = sourceNode.data as { outputVideo: string | null; outputTaskId?: string | null };
        if (sourceHandle === "taskId") {
          return { type: "text", value: veoData.outputTaskId || null };
        }
        return { type: "video", value: veoData.outputVideo };
      } else if (sourceNode.type === "videoStitch") {
        return { type: "video", value: (sourceNode.data as VideoStitchNodeData).outputVideo };
      } else if (sourceNode.type === "easeCurve") {
        return { type: "video", value: (sourceNode.data as EaseCurveNodeData).outputVideo };
      } else if (sourceNode.type === "prompt") {
        return { type: "text", value: (sourceNode.data as PromptNodeData).prompt };
      } else if (sourceNode.type === "klingPrompt") {
        const klingData = sourceNode.data as KlingPromptNodeData;
        const shotText = klingData.shots
          .map((shot) => shot.prompt)
          .filter((text) => text && text.trim().length > 0)
          .join("\n");
        return { type: "text", value: klingData.multiShots ? (shotText || klingData.prompt) : klingData.prompt };
      } else if (sourceNode.type === "promptConstructor") {
        const pcData = sourceNode.data as PromptConstructorNodeData;
        return { type: "text", value: pcData.outputText || pcData.template || null };
      } else if (sourceNode.type === "llmGenerate") {
        return { type: "text", value: (sourceNode.data as LLMGenerateNodeData).outputText };
      } else if (sourceNode.type === "soraStoryboard") {
        const soraData = sourceNode.data as SoraStoryboardNodeData;
        if (sourceHandle === "taskId") {
          return { type: "text", value: soraData.outputTaskId || null };
        }
        return { type: "video", value: soraData.outputVideo || null };
      }
      return { type: "image", value: null };

    };

    edges
      .filter((edge) => edge.target === nodeId)
      .forEach((edge) => {
        const sourceNode = nodes.find((n) => n.id === edge.source);
        if (!sourceNode) return;

        const handleId = edge.targetHandle;
        const { type, value } = getSourceOutput(sourceNode, edge.sourceHandle);

        if (!value) return;

        // Map normalized handle ID to schema name for dynamicInputs
        // This allows API to receive schema-specific parameter names
        if (handleId && handleToSchemaName[handleId]) {
          const schemaName = handleToSchemaName[handleId];
          const existing = dynamicInputs[schemaName];
          if (existing !== undefined) {
            dynamicInputs[schemaName] = Array.isArray(existing)
              ? [...existing, value]
              : [existing, value];
          } else {
            dynamicInputs[schemaName] = value;
          }
        }

        // Route to typed arrays based on source output type
        // This preserves type information from the source node
        if (handleId === "taskId") {
          taskId = value;
        } else if (type === "video") {
          videos.push(value);
        } else if (type === "audio") {
          audio.push(value);
        } else if (type === "text" || isTextHandle(handleId)) {
          text = value;
        } else if (isImageHandle(handleId) || !handleId) {
          images.push(value);
        }
      });

    // Extract easeCurve data from parent EaseCurve node
    let easeCurve: { bezierHandles: [number, number, number, number]; easingPreset: string | null } | null = null;
    const easeCurveEdge = edges.find(
      (e) => e.target === nodeId && e.targetHandle === "easeCurve"
    );
    if (easeCurveEdge) {
      const sourceNode = nodes.find((n) => n.id === easeCurveEdge.source);
      if (sourceNode?.type === "easeCurve") {
        const sourceData = sourceNode.data as EaseCurveNodeData;
        easeCurve = {
          bezierHandles: sourceData.bezierHandles,
          easingPreset: sourceData.easingPreset,
        };
      }
    }

    return { images, videos, audio, text, taskId, dynamicInputs, easeCurve };
  },

  validateWorkflow: () => {
    const { nodes, edges } = get();
    const errors: string[] = [];

    // Check if there are any nodes
    if (nodes.length === 0) {
      errors.push("Workflow is empty");
      return { valid: false, errors };
    }

    // Check each Nano Banana node has required inputs (text required, image optional)
    nodes
      .filter((n) => n.type === "nanoBanana" || n.type === "nanoBananaEdit")
      .forEach((node) => {
        const textConnected = edges.some(
          (e) => e.target === node.id &&
                 (e.targetHandle === "text" || e.targetHandle?.startsWith("text-"))
        );

        if (!textConnected) {
          const nodeLabel = node.type === "nanoBananaEdit" ? "Edit node" : "Generate node";
          errors.push(`${nodeLabel} "${node.id}" missing text input`);
        }
      });

    // Check soraStoryboard nodes have reference image and correct total duration
    nodes
      .filter((n) => n.type === "soraStoryboard")
      .forEach((node) => {
        const data = node.data as SoraStoryboardNodeData;
        
        // Check image input
        const imageConnected = edges.some(
          (e) => e.target === node.id && e.targetHandle === "image"
        );
        if (!imageConnected) {
          errors.push(`Sora Storyboard "${node.id}" missing reference image input`);
        }

        // Check total duration
        const totalDuration = data.scenes.reduce((sum, s) => sum + s.duration, 0);
        const targetDuration = parseInt(data.nFrames);
        if (Math.abs(totalDuration - targetDuration) > 0.01) {
          errors.push(`Sora Storyboard "${node.id}" total duration (${totalDuration}s) must match frame duration (${targetDuration}s)`);
        }
      });

    // Check Kling 3 prompt nodes have valid shot durations
    nodes
      .filter((n) => n.type === "klingPrompt")
      .forEach((node) => {
        const data = node.data as KlingPromptNodeData;
        if (data.multiShots) {
          const totalDuration = data.shots.reduce((sum, shot) => sum + shot.duration, 0);
          if (data.shots.length < 2) {
            errors.push(`Kling 3 Prompt "${node.id}" requires at least 2 shots`);
          }
          if (Math.abs(totalDuration - 15) > 0.01) {
            errors.push(`Kling 3 Prompt "${node.id}" total duration (${totalDuration}s) must equal 15s`);
          }
        }
      });

    // Check generateVideo nodes have required text input
    nodes
      .filter((n) => n.type === "generateVideo")
      .forEach((node) => {
        const nodeData = node.data as GenerateVideoNodeData;
        const isKling3 = nodeData.selectedModel?.modelId === "kling-3.0/video";
        const textConnected = edges.some(
          (e) => e.target === node.id &&
                 (e.targetHandle === "text" || e.targetHandle?.startsWith("text-"))
        );
        const klingPromptConnected = edges.some((e) => {
          if (e.target !== node.id) return false;
          const sourceNode = nodes.find((n) => n.id === e.source);
          return sourceNode?.type === "klingPrompt";
        });

        if (isKling3) {
          if (!klingPromptConnected) {
            errors.push(`Video node "${node.id}" requires a Kling 3 Prompt node`);
          }
        } else if (!textConnected) {
          errors.push(`Video node "${node.id}" missing text input`);
        }
      });

    // Check Veo reference nodes have prompt and image input
    nodes
      .filter((n) => n.type === "veoReferenceVideo")
      .forEach((node) => {
        const textConnected = edges.some(
          (e) => e.target === node.id &&
                 (e.targetHandle === "text" || e.targetHandle?.startsWith("text-"))
        );
        const imageConnected = edges.some(
          (e) => e.target === node.id &&
                 (e.targetHandle === "image" || e.targetHandle?.startsWith("image-"))
        );
        const nodeData = node.data as { inputPrompt?: string | null };

        if (!textConnected && !nodeData.inputPrompt) {
          errors.push(`Veo reference node "${node.id}" missing prompt input`);
        }
        if (!imageConnected) {
          errors.push(`Veo reference node "${node.id}" missing image input`);
        }
      });

    // Check Veo extend nodes have taskId and prompt input
    nodes
      .filter((n) => n.type === "veoExtendVideo")
      .forEach((node) => {
        const taskIdConnected = edges.some(
          (e) => e.target === node.id && e.targetHandle === "taskId"
        );
        const textConnected = edges.some(
          (e) => e.target === node.id &&
                 (e.targetHandle === "text" || e.targetHandle?.startsWith("text-"))
        );
        const nodeData = node.data as { inputTaskId?: string | null; inputPrompt?: string | null };

        if (!taskIdConnected && !nodeData.inputTaskId) {
          errors.push(`Veo extend node "${node.id}" missing taskId input`);
        }
        if (!textConnected && !nodeData.inputPrompt) {
          errors.push(`Veo extend node "${node.id}" missing prompt input`);
        }
      });

    // Check Veo 1080p/4k nodes have taskId input
    nodes
      .filter((n) => n.type === "veo1080pVideo" || n.type === "veo4kVideo")
      .forEach((node) => {
        const taskIdConnected = edges.some(
          (e) => e.target === node.id && e.targetHandle === "taskId"
        );
        const nodeData = node.data as { inputTaskId?: string | null };

        if (!taskIdConnected && !nodeData.inputTaskId) {
          errors.push(`Veo ${node.type === "veo1080pVideo" ? "1080p" : "4k"} node "${node.id}" missing taskId input`);
        }
      });

    // Check annotation nodes have image input (either connected or manually loaded)
    nodes
      .filter((n) => n.type === "annotation")
      .forEach((node) => {
        const imageConnected = edges.some((e) => e.target === node.id);
        const hasManualImage = (node.data as AnnotationNodeData).sourceImage !== null;
        if (!imageConnected && !hasManualImage) {
          errors.push(`Annotation node "${node.id}" missing image input`);
        }
      });

    // Check output nodes have image input
    nodes
      .filter((n) => n.type === "output")
      .forEach((node) => {
        const imageConnected = edges.some((e) => e.target === node.id);
        if (!imageConnected) {
          errors.push(`Output node "${node.id}" missing image input`);
        }
      });

    return { valid: errors.length === 0, errors };
  },

  executeWorkflow: async (startFromNodeId?: string) => {
    const { nodes, edges, groups, updateNodeData, getConnectedInputs, isRunning, maxConcurrentCalls } = get();

    if (isRunning) {
      logger.warn('workflow.start', 'Workflow already running, ignoring execution request');
      return;
    }

    // Create AbortController for this execution run
    const abortController = new AbortController();
    const isResuming = startFromNodeId === get().pausedAtNodeId;
    set({ isRunning: true, pausedAtNodeId: null, currentNodeIds: [], _abortController: abortController });

    // Start logging session
    await logger.startSession();

    logger.info('workflow.start', 'Workflow execution started', {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      startFromNodeId,
      isResuming,
      maxConcurrentCalls,
    });

    // Group nodes by level for parallel execution
    const levels = groupNodesByLevel(nodes, edges);

    // Find starting level if startFromNodeId specified
    let startLevel = 0;
    if (startFromNodeId) {
      const foundLevel = levels.findIndex((l) => l.nodeIds.includes(startFromNodeId));
      if (foundLevel !== -1) startLevel = foundLevel;
    }

    // Helper to execute a single node - returns true if successful, throws on error
    const executeSingleNode = async (node: WorkflowNode, signal: AbortSignal): Promise<void> => {
      // Check for abort before starting
      if (signal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      // Check for pause edges on incoming connections (skip if resuming from this exact node)
      const isResumingThisNode = isResuming && node.id === startFromNodeId;
      if (!isResumingThisNode) {
        const incomingEdges = edges.filter((e) => e.target === node.id);
        const pauseEdge = incomingEdges.find((e) => e.data?.hasPause);
        if (pauseEdge) {
          logger.info('workflow.end', 'Workflow paused at node', {
            nodeId: node.id,
            nodeType: node.type,
          });
          set({ pausedAtNodeId: node.id });
          useToast.getState().show("Workflow paused - click Run to continue", "warning");

          // Signal to stop the entire workflow — outer loop handles isRunning/session cleanup
          abortController.abort();
          return;
        }
      }

      // Check if node is in a locked group - if so, skip execution
      const nodeGroup = node.groupId ? groups[node.groupId] : null;
      if (nodeGroup?.locked) {
        logger.info('node.execution', `Skipping node in locked group`, {
          nodeId: node.id,
          nodeType: node.type,
          groupId: node.groupId,
          groupName: nodeGroup.name,
        });
        return; // Skip this node but continue with others
      }

      logger.info('node.execution', `Executing ${node.type} node`, {
        nodeId: node.id,
        nodeType: node.type,
      });

      // NOTE: The switch statement below executes the node based on its type
      // The signal parameter should be passed to any fetch calls for cancellation

      switch (node.type) {
          case "imageInput":
            // Nothing to execute, data is already set
            break;

          case "audioInput":
            // Audio input is a data source - no execution needed
            break;

          case "annotation": {
            try {
              // Get connected image and set as source (use first image)
              const { images } = getConnectedInputs(node.id);
              const image = images[0] || null;
              if (image) {
                updateNodeData(node.id, { sourceImage: image });
                // If no annotations, pass through the image
                const nodeData = node.data as AnnotationNodeData;
                if (!nodeData.outputImage) {
                  updateNodeData(node.id, { outputImage: image });
                }
              }
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              console.error(`[Workflow] Annotation node ${node.id} failed:`, message);
              updateNodeData(node.id, { error: message });
            }
            break;
          }

          case "prompt": {
            try {
              // Check for connected text input and update prompt if connected
              const { text: connectedText } = getConnectedInputs(node.id);
              if (connectedText !== null) {
                updateNodeData(node.id, { prompt: connectedText });
              }
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              console.error(`[Workflow] Prompt node ${node.id} failed:`, message);
              updateNodeData(node.id, { error: message });
            }
            break;
          }

          case "promptConstructor": {
            try {
              // Get fresh node data from store
              const freshNode = get().nodes.find((n) => n.id === node.id);
              const nodeData = (freshNode?.data || node.data) as PromptConstructorNodeData;
              const template = nodeData.template;

              // Find connected prompt nodes via text edges
              const connectedPromptNodes = edges
                .filter((e) => e.target === node.id && e.targetHandle === "text")
                .map((e) => nodes.find((n) => n.id === e.source))
                .filter((n): n is WorkflowNode => n !== undefined && n.type === "prompt");

              // Build variable map from connected prompt nodes
              const variableMap: Record<string, string> = {};
              connectedPromptNodes.forEach((promptNode) => {
                const promptData = promptNode.data as PromptNodeData;
                if (promptData.variableName) {
                  variableMap[promptData.variableName] = promptData.prompt;
                }
              });

              // Find all @variable patterns in template
              const varPattern = /@(\w+)/g;
              const unresolvedVars: string[] = [];
              let resolvedText = template;

              // Replace @variables with values or track unresolved
              const matches = template.matchAll(varPattern);
              for (const match of matches) {
                const varName = match[1];
                if (variableMap[varName] !== undefined) {
                  // Replace with actual value
                  resolvedText = resolvedText.replaceAll(`@${varName}`, variableMap[varName]);
                } else {
                  // Track unresolved variable
                  if (!unresolvedVars.includes(varName)) {
                    unresolvedVars.push(varName);
                  }
                }
              }

              // Update node with resolved text and unresolved vars list
              updateNodeData(node.id, {
                outputText: resolvedText,
                unresolvedVars,
              });
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              console.error(`[Workflow] PromptConstructor node ${node.id} failed:`, message);
              updateNodeData(node.id, { error: message });
            }
            break;
          }

          case "nanoBanana": {
            const { images, text, dynamicInputs } = getConnectedInputs(node.id);

            // For dynamic inputs, check if we have at least a prompt
            const promptFromDynamic = Array.isArray(dynamicInputs.prompt)
              ? dynamicInputs.prompt[0]
              : dynamicInputs.prompt;
            const promptText = text || (typeof promptFromDynamic === "string" ? promptFromDynamic : null);
            if (!promptText) {
              logger.error('node.error', 'nanoBanana node missing text input', {
                nodeId: node.id,
              });
              updateNodeData(node.id, {
                status: "error",
                error: "Missing text input",
              });
              throw new Error("Missing text input");
            }

            updateNodeData(node.id, {
              inputImages: images,
              inputPrompt: promptText,
              status: "loading",
              error: null,
            });

            try {
              // Get fresh node data from store (not stale data from sorted array)
              const freshNode = get().nodes.find((n) => n.id === node.id);
              const nodeData = (freshNode?.data || node.data) as NanoBananaNodeData;
              const providerSettingsState = get().providerSettings;

              const requestPayload = {
                images,
                prompt: promptText,
                aspectRatio: nodeData.aspectRatio,
                resolution: nodeData.resolution,
                model: nodeData.model,
                useGoogleSearch: nodeData.useGoogleSearch,
                selectedModel: nodeData.selectedModel,
                parameters: nodeData.parameters,
                dynamicInputs,  // Pass dynamic inputs for schema-mapped connections
              };

              // Build headers with API keys for providers
              const headers: Record<string, string> = {
                "Content-Type": "application/json",
              };
              const provider = nodeData.selectedModel?.provider || "gemini";
              if (provider === "gemini") {
                const geminiConfig = providerSettingsState.providers.gemini;
                if (geminiConfig?.apiKey) {
                  headers["X-Gemini-API-Key"] = geminiConfig.apiKey;
                }
              } else if (provider === "replicate") {
                const replicateConfig = providerSettingsState.providers.replicate;
                if (replicateConfig?.apiKey) {
                  headers["X-Replicate-API-Key"] = replicateConfig.apiKey;
                }
              } else if (provider === "fal") {
                const falConfig = providerSettingsState.providers.fal;
                if (falConfig?.apiKey) {
                  headers["X-Fal-API-Key"] = falConfig.apiKey;
                }
              } else if (provider === "kie") {
                const kieConfig = providerSettingsState.providers.kie;
                if (kieConfig?.apiKey) {
                  headers["X-Kie-Key"] = kieConfig.apiKey;
                }
              } else if (provider === "wavespeed") {
                const wavespeedConfig = providerSettingsState.providers.wavespeed;
                if (wavespeedConfig?.apiKey) {
                  headers["X-WaveSpeed-Key"] = wavespeedConfig.apiKey;
                }
              }

              logger.info('node.execution', `Calling ${provider} API for image generation`, {
                nodeId: node.id,
                provider,
                model: nodeData.selectedModel?.modelId || nodeData.model,
                aspectRatio: nodeData.aspectRatio,
                resolution: nodeData.resolution,
                imageCount: images.length,
                prompt: promptText,
              });

              const response = await fetch("/api/generate", {
                method: "POST",
                headers,
                body: JSON.stringify(requestPayload),
                signal,  // Pass abort signal for cancellation
              });

              if (!response.ok) {
                const errorText = await response.text();
                let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
                try {
                  const errorJson = JSON.parse(errorText);
                  errorMessage = errorJson.error || errorMessage;
                } catch {
                  if (errorText) errorMessage += ` - ${errorText.substring(0, 200)}`;
                }

                logger.error('api.error', `${provider} API request failed`, {
                  nodeId: node.id,
                  provider,
                  status: response.status,
                  statusText: response.statusText,
                  errorMessage,
                });

                updateNodeData(node.id, {
                  status: "error",
                  error: errorMessage,
                });
                throw new Error(errorMessage);
              }

              const result = await response.json();

              if (result.success && result.image) {
                const timestamp = Date.now();
                const imageId = `${timestamp}`;

                // Save the newly generated image to global history
                get().addToGlobalHistory({
                  image: result.image,
                  timestamp,
                  prompt: promptText,
                  aspectRatio: nodeData.aspectRatio,
                  model: nodeData.model,
                });

                // Add to node's carousel history
                const newHistoryItem = {
                  id: imageId,
                  timestamp,
                  prompt: promptText,
                  aspectRatio: nodeData.aspectRatio,
                  model: nodeData.model,
                };
                const updatedHistory = [newHistoryItem, ...(nodeData.imageHistory || [])];

                updateNodeData(node.id, {
                  outputImage: result.image,
                  status: "complete",
                  error: null,
                  imageHistory: updatedHistory,
                  selectedHistoryIndex: 0,
                });

                // Push new image to connected downstream outputGallery nodes
                get().edges
                  .filter(e => e.source === node.id)
                  .forEach(e => {
                    const target = get().nodes.find(n => n.id === e.target);
                    if (target?.type === "outputGallery") {
                      const gData = target.data as OutputGalleryNodeData;
                      updateNodeData(target.id, {
                        images: [result.image, ...(gData.images || [])],
                      });
                    }
                  });

                // Track cost
                // Cost tracking: Gemini (hardcoded), fal.ai (from API). Replicate excluded (no pricing API).
                if (nodeData.selectedModel?.provider === "fal" && nodeData.selectedModel?.pricing) {
                  // External fal.ai provider - use pricing from selectedModel
                  get().addIncurredCost(nodeData.selectedModel.pricing.amount);
                } else if (!nodeData.selectedModel || nodeData.selectedModel.provider === "gemini") {
                  // Legacy Gemini or Gemini via selectedModel - use hardcoded pricing
                  const generationCost = calculateGenerationCost(nodeData.model, nodeData.resolution);
                  get().addIncurredCost(generationCost);
                }
                // Note: Replicate has no pricing API, so costs are not tracked

                // Auto-save to generations folder if configured
                const genPath = get().generationsPath;
                if (genPath) {
                  trackSaveGeneration(genPath, { image: result.image }, text, imageId, node.id, 'image', get, updateNodeData);
                }
              } else {
                logger.error('api.error', `${provider} API generation failed`, {
                  nodeId: node.id,
                  provider,
                  error: result.error,
                });
                updateNodeData(node.id, {
                  status: "error",
                  error: result.error || "Generation failed",
                });
                throw new Error(result.error || "Generation failed");
              }
            } catch (error) {
              let errorMessage = "Generation failed";
              if (error instanceof DOMException && error.name === 'AbortError') {
                errorMessage = "Request timed out. Try reducing image sizes or using a simpler prompt.";
              } else if (error instanceof TypeError && error.message.includes('NetworkError')) {
                errorMessage = "Network error. Check your connection and try again.";
              } else if (error instanceof TypeError) {
                errorMessage = `Network error: ${error.message}`;
              } else if (error instanceof Error) {
                errorMessage = error.message;
              }

              const nodeData = node.data as NanoBananaNodeData;
              const errorProvider = nodeData.selectedModel?.provider || "gemini";
              logger.error('node.error', 'Generate node execution failed', {
                nodeId: node.id,
                provider: errorProvider,
                errorMessage,
              }, error instanceof Error ? error : undefined);

              updateNodeData(node.id, {
                status: "error",
                error: errorMessage,
              });
              if (error instanceof DOMException && error.name === 'AbortError') throw error;
              throw new Error(errorMessage);
            }
            break;
          }

          case "generateVideo": {
            const { images, text, dynamicInputs } = getConnectedInputs(node.id);

            // Get fresh node data from store (not stale data from sorted array)
            const freshVideoNode = get().nodes.find((n) => n.id === node.id);
            const nodeData = (freshVideoNode?.data || node.data) as GenerateVideoNodeData;

            if (!nodeData.selectedModel?.modelId) {
              logger.error('node.error', 'generateVideo node missing model selection', {
                nodeId: node.id,
              });
              updateNodeData(node.id, {
                status: "error",
                error: "No model selected",
              });
              throw new Error("No model selected");
            }

            const isKling3 = nodeData.selectedModel?.modelId === "kling-3.0/video";
            let promptText = text;
            let requestParameters: Record<string, unknown> | undefined = nodeData.parameters;
            let requestDynamicInputs: Record<string, unknown> | undefined = dynamicInputs;

            if (isKling3) {
              const klingEdge = edges.find((edge) => {
                if (edge.target !== node.id) return false;
                const sourceNode = nodes.find((n) => n.id === edge.source);
                return sourceNode?.type === "klingPrompt";
              });

              const klingNode = klingEdge ? nodes.find((n) => n.id === klingEdge.source) : undefined;
              const klingData = klingNode?.data as KlingPromptNodeData | undefined;

              if (klingData) {
                const shotPrompts = klingData.shots.map((shot) => shot.prompt).filter((prompt) => prompt.trim().length > 0);
                const totalDuration = klingData.shots.reduce((sum, shot) => sum + shot.duration, 0);
                const klingPromptText = klingData.multiShots
                  ? (klingData.prompt || shotPrompts.join("\n"))
                  : klingData.prompt;

                promptText = klingPromptText;

                const mergedParameters: Record<string, unknown> = {
                  aspect_ratio: klingData.aspectRatio,
                  duration: String(klingData.multiShots ? totalDuration : klingData.duration),
                  mode: klingData.mode,
                  sound: klingData.sound,
                  multi_shots: klingData.multiShots,
                };

                const mergedDynamicInputs: Record<string, unknown> = {
                  ...(dynamicInputs || {}),
                };

                if (klingData.multiShots) {
                  mergedDynamicInputs.multi_prompt = klingData.shots.map((shot) => ({
                    prompt: shot.prompt,
                    duration: shot.duration,
                  }));
                } else {
                  delete mergedDynamicInputs.multi_prompt;
                }

                if (klingData.elements && klingData.elements.length > 0) {
                  mergedDynamicInputs.kling_elements = klingData.elements;
                } else {
                  delete mergedDynamicInputs.kling_elements;
                }

                requestParameters = mergedParameters;
                requestDynamicInputs = Object.keys(mergedDynamicInputs).length > 0 ? mergedDynamicInputs : undefined;
              }
            }

            // For dynamic inputs, check if we have at least a prompt
            const hasPrompt = promptText || requestDynamicInputs?.prompt || requestDynamicInputs?.negative_prompt;
            if (!hasPrompt && images.length === 0) {
              logger.error('node.error', 'generateVideo node missing inputs', {
                nodeId: node.id,
              });
              updateNodeData(node.id, {
                status: "error",
                error: "Missing required inputs",
              });
              throw new Error("Missing required inputs");
            }

            updateNodeData(node.id, {
              inputImages: images,
              inputPrompt: promptText,
              status: "loading",
              error: null,
            });

            try {
              const providerSettingsState = get().providerSettings;

              const requestPayload = {
                images,
                prompt: promptText,
                selectedModel: nodeData.selectedModel,
                parameters: requestParameters,
                dynamicInputs: requestDynamicInputs,  // Pass dynamic inputs for schema-mapped connections
                mediaType: "video" as const,  // Signal to API to use queue for long-running video generation
              };

              // Build headers with API keys for providers
              const headers: Record<string, string> = {
                "Content-Type": "application/json",
              };
              const provider = nodeData.selectedModel.provider;
              if (provider === "gemini") {
                const geminiConfig = providerSettingsState.providers.gemini;
                if (geminiConfig?.apiKey) {
                  headers["X-Gemini-API-Key"] = geminiConfig.apiKey;
                }
              } else if (provider === "replicate") {
                const replicateConfig = providerSettingsState.providers.replicate;
                if (replicateConfig?.apiKey) {
                  headers["X-Replicate-API-Key"] = replicateConfig.apiKey;
                }
              } else if (provider === "fal") {
                const falConfig = providerSettingsState.providers.fal;
                if (falConfig?.apiKey) {
                  headers["X-Fal-API-Key"] = falConfig.apiKey;
                }
              } else if (provider === "kie") {
                const kieConfig = providerSettingsState.providers.kie;
                if (kieConfig?.apiKey) {
                  headers["X-Kie-Key"] = kieConfig.apiKey;
                }
              } else if (provider === "wavespeed") {
                const wavespeedConfig = providerSettingsState.providers.wavespeed;
                if (wavespeedConfig?.apiKey) {
                  headers["X-WaveSpeed-Key"] = wavespeedConfig.apiKey;
                }
              }
              logger.info('node.execution', `Calling ${provider} API for video generation`, {
                nodeId: node.id,
                provider,
                model: nodeData.selectedModel.modelId,
                imageCount: images.length,
                prompt: promptText,
              });

              const response = await fetch("/api/generate", {
                method: "POST",
                headers,
                body: JSON.stringify(requestPayload),
                signal,  // Pass abort signal for cancellation
              });

              if (!response.ok) {
                const errorText = await response.text();
                let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
                try {
                  const errorJson = JSON.parse(errorText);
                  errorMessage = errorJson.error || errorMessage;
                } catch {
                  if (errorText) errorMessage += ` - ${errorText.substring(0, 200)}`;
                }

                logger.error('api.error', `${provider} API request failed`, {
                  nodeId: node.id,
                  provider,
                  status: response.status,
                  statusText: response.statusText,
                  errorMessage,
                });

                updateNodeData(node.id, {
                  status: "error",
                  error: errorMessage,
                });
                throw new Error(errorMessage);
              }

              const result = await response.json();

              // Handle video response (video or videoUrl field)
              const videoData = result.video || result.videoUrl;
              if (result.success && videoData) {
                const timestamp = Date.now();
                const videoId = `${timestamp}`;

                // Add to node's video history
                const newHistoryItem = {
                  id: videoId,
                  timestamp,
                  prompt: promptText || '',
                  model: nodeData.selectedModel?.modelId || '',
                };
                const updatedHistory = [newHistoryItem, ...(nodeData.videoHistory || [])].slice(0, 50);

                updateNodeData(node.id, {
                  outputVideo: videoData,
                  outputTaskId: result.taskId || null,
                  status: "complete",
                  error: null,
                  videoHistory: updatedHistory,
                  selectedVideoHistoryIndex: 0,
                });

                // Track cost for video generation
                // Cost tracking: fal.ai (from API). Replicate excluded (no pricing API).
                if (nodeData.selectedModel?.provider === "fal" && nodeData.selectedModel?.pricing) {
                  get().addIncurredCost(nodeData.selectedModel.pricing.amount);
                }
                // Note: Replicate has no pricing API, so video costs are not tracked

                // Auto-save video to generations folder if configured
                const genPath = get().generationsPath;
                if (genPath) {
                  trackSaveGeneration(genPath, { video: videoData }, promptText, videoId, node.id, 'video', get, updateNodeData);
                }
              } else if (result.success && result.image) {
                // Some models might return an image preview; treat as video for now
                const timestamp = Date.now();
                const videoId = `${timestamp}`;

                // Add to node's video history
                const newHistoryItem = {
                  id: videoId,
                  timestamp,
                  prompt: promptText || '',
                  model: nodeData.selectedModel?.modelId || '',
                };
                const updatedHistory = [newHistoryItem, ...(nodeData.videoHistory || [])].slice(0, 50);

                updateNodeData(node.id, {
                  outputVideo: result.image,
                  outputTaskId: result.taskId || null,
                  status: "complete",
                  error: null,
                  videoHistory: updatedHistory,
                  selectedVideoHistoryIndex: 0,
                });

                // Track cost for video generation (image fallback case)
                // Cost tracking: fal.ai (from API). Replicate excluded (no pricing API).
                if (nodeData.selectedModel?.provider === "fal" && nodeData.selectedModel?.pricing) {
                  get().addIncurredCost(nodeData.selectedModel.pricing.amount);
                }

                // Auto-save image preview to generations folder if configured
                const genPath = get().generationsPath;
                if (genPath) {
                  trackSaveGeneration(genPath, { image: result.image }, promptText, videoId, node.id, 'video', get, updateNodeData);
                }
              } else {
                logger.error('api.error', `${provider} API video generation failed`, {
                  nodeId: node.id,
                  provider,
                  error: result.error,
                });
                updateNodeData(node.id, {
                  status: "error",
                  error: result.error || "Video generation failed",
                });
                throw new Error(result.error || "Video generation failed");
              }
            } catch (error) {
              let errorMessage = "Video generation failed";
              if (error instanceof DOMException && error.name === 'AbortError') {
                errorMessage = "Request timed out. Video generation may take longer.";
              } else if (error instanceof TypeError && error.message.includes('NetworkError')) {
                errorMessage = "Network error. Check your connection and try again.";
              } else if (error instanceof TypeError) {
                errorMessage = `Network error: ${error.message}`;
              } else if (error instanceof Error) {
                errorMessage = error.message;
              }

              logger.error('node.error', 'GenerateVideo node execution failed', {
                nodeId: node.id,
                provider: nodeData.selectedModel?.provider,
                errorMessage,
              }, error instanceof Error ? error : undefined);

              updateNodeData(node.id, {
                status: "error",
                error: errorMessage,
              });
              if (error instanceof DOMException && error.name === 'AbortError') throw error;
              throw new Error(errorMessage);
            }
            break;
          }

          case "veoReferenceVideo": {
            const { images, text } = getConnectedInputs(node.id);
            const nodeData = node.data as VeoReferenceVideoNodeData;
            const promptText = text || nodeData.inputPrompt || null;

            if (!promptText || images.length === 0) {
              updateNodeData(node.id, {
                status: "error",
                error: "Missing required inputs",
              });
              throw new Error("Missing required inputs");
            }

            updateNodeData(node.id, {
              inputImages: images,
              inputPrompt: promptText,
              status: "loading",
              error: null,
            });

            try {
              const providerSettingsState = get().providerSettings;
              const headers: Record<string, string> = {
                "Content-Type": "application/json",
              };
              const kieConfig = providerSettingsState.providers.kie;
              if (kieConfig?.apiKey) {
                headers["X-Kie-Key"] = kieConfig.apiKey;
              }

              const response = await fetch("/api/generate", {
                method: "POST",
                headers,
                body: JSON.stringify({
                  prompt: promptText,
                  images,
                  parameters: {
                    ...nodeData.parameters,
                    aspect_ratio: nodeData.aspectRatio,
                  },
                  veoOperation: "reference",
                  mediaType: "video" as const,
                }),
                signal,
              });

              if (!response.ok) {
                const errorText = await response.text();
                let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
                try {
                  const errorJson = JSON.parse(errorText);
                  errorMessage = errorJson.error || errorMessage;
                } catch {
                  if (errorText) errorMessage += ` - ${errorText.substring(0, 200)}`;
                }
                updateNodeData(node.id, {
                  status: "error",
                  error: errorMessage,
                });
                throw new Error(errorMessage);
              }

              const result = await response.json();
              const videoData = result.video || result.videoUrl;
              if (result.success && videoData) {
                updateNodeData(node.id, {
                  outputVideo: videoData,
                  outputTaskId: result.taskId || null,
                  status: "complete",
                  error: null,
                });
              } else {
                updateNodeData(node.id, {
                  status: "error",
                  error: result.error || "Veo reference failed",
                });
                throw new Error(result.error || "Veo reference failed");
              }
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : "Veo reference failed";
              updateNodeData(node.id, {
                status: "error",
                error: errorMessage,
              });
              if (error instanceof DOMException && error.name === "AbortError") throw error;
              throw new Error(errorMessage);
            }
            break;
          }

          case "veoExtendVideo": {
            const { text, taskId } = getConnectedInputs(node.id);
            const nodeData = node.data as VeoExtendVideoNodeData;
            const promptText = text || nodeData.inputPrompt || null;
            const taskIdValue = taskId || nodeData.inputTaskId || null;

            if (!promptText || !taskIdValue) {
              updateNodeData(node.id, {
                status: "error",
                error: "Missing required inputs",
              });
              throw new Error("Missing required inputs");
            }

            updateNodeData(node.id, {
              inputPrompt: promptText,
              inputTaskId: taskIdValue,
              status: "loading",
              error: null,
            });

            try {
              const providerSettingsState = get().providerSettings;
              const headers: Record<string, string> = {
                "Content-Type": "application/json",
              };
              const kieConfig = providerSettingsState.providers.kie;
              if (kieConfig?.apiKey) {
                headers["X-Kie-Key"] = kieConfig.apiKey;
              }

              const response = await fetch("/api/generate", {
                method: "POST",
                headers,
                body: JSON.stringify({
                  prompt: promptText,
                  taskId: taskIdValue,
                  parameters: nodeData.parameters,
                  veoOperation: "extend",
                  mediaType: "video" as const,
                }),
                signal,
              });

              if (!response.ok) {
                const errorText = await response.text();
                let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
                try {
                  const errorJson = JSON.parse(errorText);
                  errorMessage = errorJson.error || errorMessage;
                } catch {
                  if (errorText) errorMessage += ` - ${errorText.substring(0, 200)}`;
                }
                updateNodeData(node.id, {
                  status: "error",
                  error: errorMessage,
                });
                throw new Error(errorMessage);
              }

              const result = await response.json();
              const videoData = result.video || result.videoUrl;
              if (result.success && videoData) {
                updateNodeData(node.id, {
                  outputVideo: videoData,
                  outputTaskId: result.taskId || null,
                  status: "complete",
                  error: null,
                });
              } else {
                updateNodeData(node.id, {
                  status: "error",
                  error: result.error || "Veo extend failed",
                });
                throw new Error(result.error || "Veo extend failed");
              }
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : "Veo extend failed";
              updateNodeData(node.id, {
                status: "error",
                error: errorMessage,
              });
              if (error instanceof DOMException && error.name === "AbortError") throw error;
              throw new Error(errorMessage);
            }
            break;
          }

          case "veo1080pVideo":
          case "veo4kVideo": {
            const { taskId } = getConnectedInputs(node.id);
            const nodeData = node.data as Veo1080pVideoNodeData | Veo4kVideoNodeData;
            const taskIdValue = taskId || nodeData.inputTaskId || null;

            if (!taskIdValue) {
              updateNodeData(node.id, {
                status: "error",
                error: "Missing required inputs",
              });
              throw new Error("Missing required inputs");
            }

            updateNodeData(node.id, {
              inputTaskId: taskIdValue,
              status: "loading",
              error: null,
            });

            try {
              const providerSettingsState = get().providerSettings;
              const headers: Record<string, string> = {
                "Content-Type": "application/json",
              };
              const kieConfig = providerSettingsState.providers.kie;
              if (kieConfig?.apiKey) {
                headers["X-Kie-Key"] = kieConfig.apiKey;
              }

              const operation = node.type === "veo1080pVideo" ? "get1080p" : "get4k";
              const response = await fetch("/api/generate", {
                method: "POST",
                headers,
                body: JSON.stringify({
                  taskId: taskIdValue,
                  parameters: nodeData.parameters,
                  veoOperation: operation,
                  mediaType: "video" as const,
                }),
                signal,
              });

              if (!response.ok) {
                const errorText = await response.text();
                let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
                try {
                  const errorJson = JSON.parse(errorText);
                  errorMessage = errorJson.error || errorMessage;
                } catch {
                  if (errorText) errorMessage += ` - ${errorText.substring(0, 200)}`;
                }
                updateNodeData(node.id, {
                  status: "error",
                  error: errorMessage,
                });
                throw new Error(errorMessage);
              }

              const result = await response.json();
              const videoData = result.video || result.videoUrl;
              if (result.success && videoData) {
                updateNodeData(node.id, {
                  outputVideo: videoData,
                  outputTaskId: result.taskId || taskIdValue,
                  status: "complete",
                  error: null,
                });
              } else {
                updateNodeData(node.id, {
                  status: "error",
                  error: result.error || "Veo upscale failed",
                });
                throw new Error(result.error || "Veo upscale failed");
              }
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : "Veo upscale failed";
              updateNodeData(node.id, {
                status: "error",
                error: errorMessage,
              });
              if (error instanceof DOMException && error.name === "AbortError") throw error;
              throw new Error(errorMessage);
            }
            break;
          }

          case "soraStoryboard": {
            const storyboardData = node.data as SoraStoryboardNodeData;
            const { images } = get().getConnectedInputs(node.id);

            const requestPayload = {
              images: images.length > 0 ? [images[0]] : [],
              prompt: "", // Unused by storyboard model but required by API
              selectedModel: {
                provider: "kie",
                modelId: "sora-2-pro-storyboard/storyboard",
              },
              parameters: {
                n_frames: storyboardData.nFrames,
                aspect_ratio: storyboardData.aspectRatio,
              },
              dynamicInputs: {
                shots: storyboardData.scenes,
              },
            };

            const response = await fetch("/api/generate", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(requestPayload),
            });

            if (!response.ok) {
              const errorData = await response.json();
              throw new Error(errorData.error || "Generation failed");
            }

            const result = await response.json();

            get().updateNodeData(node.id, {
              outputVideo: result.video || result.videoUrl || null,
              outputTaskId: result.taskId || null,
              status: "complete",
            } as Partial<SoraStoryboardNodeData>);
            break;
          }

          case "llmGenerate": {
            const inputs = getConnectedInputs(node.id);
            const images = inputs.images;
            const llmData = node.data as LLMGenerateNodeData;
            // Fall back to node's internal inputPrompt if no text connection
            const text = inputs.text ?? llmData.inputPrompt;

            if (!text) {
              logger.error('node.error', 'llmGenerate node missing text input', {
                nodeId: node.id,
              });
              updateNodeData(node.id, {
                status: "error",
                error: "Missing text input - connect a prompt node or set internal prompt",
              });
              throw new Error("Missing text input");
            }

            updateNodeData(node.id, {
              inputPrompt: text,
              inputImages: images,
              status: "loading",
              error: null,
            });

            try {
              const nodeData = node.data as LLMGenerateNodeData;
              const providerSettingsState = get().providerSettings;

              // Build headers with API keys for LLM providers
              const headers: Record<string, string> = {
                "Content-Type": "application/json",
              };
              if (nodeData.provider === "google") {
                const geminiConfig = providerSettingsState.providers.gemini;
                if (geminiConfig?.apiKey) {
                  headers["X-Gemini-API-Key"] = geminiConfig.apiKey;
                }
              } else if (nodeData.provider === "openai") {
                const openaiConfig = providerSettingsState.providers.openai;
                if (openaiConfig?.apiKey) {
                  headers["X-OpenAI-API-Key"] = openaiConfig.apiKey;
                }
              }

              logger.info('api.llm', 'Calling LLM API', {
                nodeId: node.id,
                provider: nodeData.provider,
                model: nodeData.model,
                temperature: nodeData.temperature,
                maxTokens: nodeData.maxTokens,
                hasImages: images.length > 0,
                prompt: text,
              });

              const response = await fetch("/api/llm", {
                method: "POST",
                headers,
                body: JSON.stringify({
                  prompt: text,
                  ...(images.length > 0 && { images }),
                  systemPrompt: nodeData.systemPrompt,
                  provider: nodeData.provider,
                  model: nodeData.model,
                  temperature: nodeData.temperature,
                  maxTokens: nodeData.maxTokens,
                }),
                signal,  // Pass abort signal for cancellation
              });

              if (!response.ok) {
                const errorText = await response.text();
                let errorMessage = `HTTP ${response.status}`;
                try {
                  const errorJson = JSON.parse(errorText);
                  errorMessage = errorJson.error || errorMessage;
                } catch {
                  if (errorText) errorMessage += ` - ${errorText.substring(0, 200)}`;
                }
                logger.error('api.error', 'LLM API request failed', {
                  nodeId: node.id,
                  status: response.status,
                  errorMessage,
                });
                updateNodeData(node.id, {
                  status: "error",
                  error: errorMessage,
                });
                throw new Error(errorMessage);
              }

              const result = await response.json();

              if (result.success && result.text) {
                updateNodeData(node.id, {
                  outputText: result.text,
                  status: "complete",
                  error: null,
                });
              } else {
                logger.error('api.error', 'LLM generation failed', {
                  nodeId: node.id,
                  error: result.error,
                });
                updateNodeData(node.id, {
                  status: "error",
                  error: result.error || "LLM generation failed",
                });
                throw new Error(result.error || "LLM generation failed");
              }
            } catch (error) {
              logger.error('node.error', 'llmGenerate node execution failed', {
                nodeId: node.id,
              }, error instanceof Error ? error : undefined);
              updateNodeData(node.id, {
                status: "error",
                error: error instanceof Error ? error.message : "LLM generation failed",
              });
              if (error instanceof DOMException && error.name === 'AbortError') throw error;
              throw error instanceof Error ? error : new Error("LLM generation failed");
            }
            break;
          }

          case "splitGrid": {
            const { images } = getConnectedInputs(node.id);
            const sourceImage = images[0] || null;

            if (!sourceImage) {
              updateNodeData(node.id, {
                status: "error",
                error: "No input image connected",
              });
              throw new Error("No input image connected");
            }

            const nodeData = node.data as SplitGridNodeData;

            if (!nodeData.isConfigured) {
              updateNodeData(node.id, {
                status: "error",
                error: "Node not configured - open settings first",
              });
              throw new Error("Node not configured - open settings first");
            }

            updateNodeData(node.id, {
              sourceImage,
              status: "loading",
              error: null,
            });

            try {
              // Import and use the grid splitter
              const { splitWithDimensions } = await import("@/utils/gridSplitter");
              const { images: splitImages } = await splitWithDimensions(
                sourceImage,
                nodeData.gridRows,
                nodeData.gridCols
              );

              // Populate child imageInput nodes with split images
              for (let index = 0; index < nodeData.childNodeIds.length; index++) {
                const childSet = nodeData.childNodeIds[index];
                if (splitImages[index]) {
                  // Create a promise to get image dimensions
                  await new Promise<void>((resolve) => {
                    const img = new Image();
                    img.onload = () => {
                      updateNodeData(childSet.imageInput, {
                        image: splitImages[index],
                        filename: `split-${Math.floor(index / nodeData.gridCols) + 1}-${(index % nodeData.gridCols) + 1}.png`,
                        dimensions: { width: img.width, height: img.height },
                      });
                      resolve();
                    };
                    img.onerror = () => resolve();
                    img.src = splitImages[index];
                  });
                }
              }

              updateNodeData(node.id, { status: "complete", error: null });
            } catch (error) {
              logger.error('node.error', 'splitGrid node execution failed', {
                nodeId: node.id,
              }, error instanceof Error ? error : undefined);
              updateNodeData(node.id, {
                status: "error",
                error: error instanceof Error ? error.message : "Failed to split image",
              });
              if (error instanceof DOMException && error.name === 'AbortError') throw error;
              throw error instanceof Error ? error : new Error("Failed to split image");
            }
            break;
          }

          case "output": {
            const { images, videos } = getConnectedInputs(node.id);

            // Check videos array first (typed data from source)
            if (videos.length > 0) {
              const videoContent = videos[0];
              updateNodeData(node.id, {
                image: videoContent,
                video: videoContent,
                contentType: "video"
              });

              // Save to /outputs directory if project persistence is configured
              const { saveDirectoryPath, projectId, workflowId } = get();
              if (saveDirectoryPath || projectId) {
                const outputNodeData = node.data as OutputNodeData;
                const outputsPath = saveDirectoryPath
                  ? `${saveDirectoryPath}/outputs`
                  : getProjectOutputsPublicPath(projectId as string);

                // Fire and forget - don't block workflow execution
                fetch("/api/save-generation", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    directoryPath: outputsPath,
                    projectId: projectId || undefined,
                    workflowId: workflowId || undefined,
                    nodeId: node.id,
                    video: videoContent,
                    customFilename: outputNodeData.outputFilename || undefined,
                    createDirectory: true, // Create /outputs if it doesn't exist
                  }),
                }).catch((err) => {
                  console.error("Failed to save output:", err);
                });
              }
            } else if (images.length > 0) {
              const content = images[0];
              // Fallback pattern matching for edge cases (video data that ended up in images array)
              const isVideoContent =
                content.startsWith("data:video/") ||
                content.includes(".mp4") ||
                content.includes(".webm") ||
                content.includes("fal.media");  // fal.ai video URLs

              if (isVideoContent) {
                updateNodeData(node.id, {
                  image: content,
                  video: content,
                  contentType: "video"
                });
              } else {
                updateNodeData(node.id, {
                  image: content,
                  video: null,
                  contentType: "image"
                });
              }

              // Save to /outputs directory if project persistence is configured
              const { saveDirectoryPath, projectId, workflowId } = get();
              if (saveDirectoryPath || projectId) {
                const outputNodeData = node.data as OutputNodeData;
                const outputsPath = saveDirectoryPath
                  ? `${saveDirectoryPath}/outputs`
                  : getProjectOutputsPublicPath(projectId as string);

                // Fire and forget - don't block workflow execution
                fetch("/api/save-generation", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    directoryPath: outputsPath,
                    projectId: projectId || undefined,
                    workflowId: workflowId || undefined,
                    nodeId: node.id,
                    image: isVideoContent ? undefined : content,
                    video: isVideoContent ? content : undefined,
                    customFilename: outputNodeData.outputFilename || undefined,
                    createDirectory: true, // Create /outputs if it doesn't exist
                  }),
                }).catch((err) => {
                  console.error("Failed to save output:", err);
                });
              }
            }
            break;
          }

          case "outputGallery": {
            const { images } = getConnectedInputs(node.id);
            const galleryData = node.data as OutputGalleryNodeData;
            const existing = new Set(galleryData.images || []);
            const newImages = images.filter(img => !existing.has(img));
            if (newImages.length > 0) {
              updateNodeData(node.id, {
                images: [...newImages, ...(galleryData.images || [])],
              });
            }
            break;
          }

          case "imageCompare": {
            const { images } = getConnectedInputs(node.id);
            updateNodeData(node.id, {
              imageA: images[0] || null,
              imageB: images[1] || null,
            });
            break;
          }

          case "videoStitch": {
            const nodeData = node.data as VideoStitchNodeData;

            // Check encoder support
            if (nodeData.encoderSupported === false) {
              updateNodeData(node.id, {
                status: "error",
                error: "Browser does not support video encoding",
                progress: 0,
              });
              break;
            }

            updateNodeData(node.id, { status: "loading", progress: 0, error: null });

            try {
              const inputs = getConnectedInputs(node.id);

              if (inputs.videos.length < 2) {
                updateNodeData(node.id, {
                  status: "error",
                  error: "Need at least 2 video clips to stitch",
                  progress: 0,
                });
                break;
              }

              // Convert video data/blob URLs to Blobs
              const videoBlobs = await Promise.all(
                inputs.videos.map((v) => fetch(v).then((r) => r.blob()))
              );

              // Prepare audio if connected
              let audioData = null;
              if (inputs.audio.length > 0 && inputs.audio[0]) {
                const { prepareAudioAsync } = await import('@/hooks/useAudioMixing');
                const audioUrl = inputs.audio[0];
                const audioResponse = await fetch(audioUrl);
                const rawBlob = await audioResponse.blob();
                // Ensure the blob has the correct MIME type for MediaBunny format detection
                // Data URLs from AudioInput preserve the original MIME type, but fetch() may lose it
                const audioMime = rawBlob.type || (audioUrl.startsWith('data:') ? audioUrl.split(';')[0].split(':')[1] : 'audio/mpeg');
                const audioBlob = rawBlob.type ? rawBlob : new Blob([rawBlob], { type: audioMime });
                audioData = await prepareAudioAsync(audioBlob, 0);
              }

              // Stitch videos
              const { stitchVideosAsync } = await import('@/hooks/useStitchVideos');
              const outputBlob = await stitchVideosAsync(
                videoBlobs,
                audioData,
                (progress) => {
                  updateNodeData(node.id, { progress: progress.progress });
                }
              );

              // Revoke old blob URL before replacing
              revokeBlobUrl((node.data as Record<string, unknown>).outputVideo as string | undefined);

              // Store output - blob URL for large files, data URL for small
              let outputVideo: string;
              if (outputBlob.size > 20 * 1024 * 1024) {
                // Large file: use blob URL
                outputVideo = URL.createObjectURL(outputBlob);
              } else {
                // Small file: convert to data URL for workflow saving
                const reader = new FileReader();
                outputVideo = await new Promise<string>((resolve) => {
                  reader.onload = () => resolve(reader.result as string);
                  reader.readAsDataURL(outputBlob);
                });
              }

              updateNodeData(node.id, {
                outputVideo,
                status: "complete",
                progress: 100,
                error: null,
              });
            } catch (err) {
              const errorMessage = err instanceof Error ? err.message : "Stitch failed";
              updateNodeData(node.id, {
                status: "error",
                error: errorMessage,
                progress: 0,
              });
            }
            break;
          }

          case "easeCurve": {
            const nodeData = node.data as EaseCurveNodeData;

            // Check encoder support
            if (nodeData.encoderSupported === false) {
              updateNodeData(node.id, {
                status: "error",
                error: "Browser does not support video encoding",
                progress: 0,
              });
              break;
            }

            updateNodeData(node.id, { status: "loading", progress: 0, error: null });

            try {
              const inputs = getConnectedInputs(node.id);

              // Propagate parent easeCurve settings if inherited
              let activeBezierHandles = nodeData.bezierHandles;
              let activeEasingPreset = nodeData.easingPreset;
              if (inputs.easeCurve) {
                activeBezierHandles = inputs.easeCurve.bezierHandles;
                activeEasingPreset = inputs.easeCurve.easingPreset;
                const easeCurveSourceId = edges.filter(
                  (e) => e.target === node.id && e.targetHandle === "easeCurve"
                )[0]?.source ?? null;
                updateNodeData(node.id, {
                  bezierHandles: activeBezierHandles,
                  easingPreset: activeEasingPreset,
                  inheritedFrom: easeCurveSourceId,
                });
              }

              if (inputs.videos.length === 0) {
                updateNodeData(node.id, {
                  status: "error",
                  error: "Connect a video input to apply ease curve",
                  progress: 0,
                });
                break;
              }

              // Get the first connected video (EaseCurve takes single video input)
              const videoUrl = inputs.videos[0];
              const videoBlob = await fetch(videoUrl).then((r) => r.blob());

              // Get video duration for warpTime input
              const videoDuration = await new Promise<number>((resolve) => {
                const video = document.createElement("video");
                video.preload = "metadata";
                video.onloadedmetadata = () => {
                  resolve(video.duration);
                  URL.revokeObjectURL(video.src);
                };
                video.onerror = () => {
                  resolve(5); // Fallback to 5 seconds
                  URL.revokeObjectURL(video.src);
                };
                video.src = URL.createObjectURL(videoBlob);
              });

              // Determine easing function: use named preset if set, otherwise create from Bezier handles
              let easingFunction: string | ((t: number) => number);
              if (activeEasingPreset) {
                easingFunction = activeEasingPreset;
              } else {
                const { createBezierEasing } = await import('@/lib/easing-functions');
                easingFunction = createBezierEasing(
                  activeBezierHandles[0],
                  activeBezierHandles[1],
                  activeBezierHandles[2],
                  activeBezierHandles[3]
                );
              }

              // Apply speed curve
              const { applySpeedCurveAsync } = await import('@/hooks/useApplySpeedCurve');
              const outputBlob = await applySpeedCurveAsync(
                videoBlob,
                videoDuration,
                nodeData.outputDuration,
                (progress) => {
                  updateNodeData(node.id, { progress: progress.progress });
                },
                easingFunction
              );

              if (!outputBlob) {
                throw new Error("Speed curve processing returned no output");
              }

              // Revoke old blob URL before replacing
              revokeBlobUrl((node.data as Record<string, unknown>).outputVideo as string | undefined);

              // Store output - blob URL for large files, data URL for small
              let outputVideo: string;
              if (outputBlob.size > 20 * 1024 * 1024) {
                outputVideo = URL.createObjectURL(outputBlob);
              } else {
                const reader = new FileReader();
                outputVideo = await new Promise<string>((resolve) => {
                  reader.onload = () => resolve(reader.result as string);
                  reader.readAsDataURL(outputBlob);
                });
              }

              updateNodeData(node.id, {
                outputVideo,
                status: "complete",
                progress: 100,
                error: null,
              });
            } catch (err) {
              const errorMessage = err instanceof Error ? err.message : "Ease curve processing failed";
              updateNodeData(node.id, {
                status: "error",
                error: errorMessage,
                progress: 0,
              });
            }
            break;
          }
        }
    }; // End of executeSingleNode helper

    try {
      // Execute levels sequentially, but nodes within each level in parallel
      for (let levelIdx = startLevel; levelIdx < levels.length; levelIdx++) {
        // Check if execution was stopped
        if (abortController.signal.aborted || !get().isRunning) break;

        const level = levels[levelIdx];
        const levelNodes = level.nodeIds
          .map((id) => nodes.find((n) => n.id === id))
          .filter((n): n is WorkflowNode => n !== undefined);

        if (levelNodes.length === 0) continue;

        // Execute nodes in batches respecting concurrency limit
        const batches = chunk(levelNodes, maxConcurrentCalls);

        for (const batch of batches) {
          if (abortController.signal.aborted || !get().isRunning) break;

          // Update currentNodeIds to show which nodes are executing
          const batchIds = batch.map((n) => n.id);
          set({ currentNodeIds: batchIds });

          logger.info('node.execution', `Executing level ${levelIdx} batch`, {
            level: levelIdx,
            nodeCount: batch.length,
            nodeIds: batchIds,
          });

          // Execute batch in parallel
          const results = await Promise.allSettled(
            batch.map((node) => executeSingleNode(node, abortController.signal))
          );

          // Check for failures (fail-fast behavior)
          const failed = results.find(
            (r): r is PromiseRejectedResult =>
              r.status === 'rejected' &&
              !(r.reason instanceof DOMException && r.reason.name === 'AbortError')
          );

          if (failed) {
            // Log the failure and abort remaining executions
            logger.error('workflow.error', 'Node execution failed in parallel batch', {
              level: levelIdx,
              error: failed.reason instanceof Error ? failed.reason.message : String(failed.reason),
            });
            abortController.abort();
            throw failed.reason;
          }
        }
      }

      // Check if we completed or were aborted
      if (!abortController.signal.aborted && get().isRunning) {
        logger.info('workflow.end', 'Workflow execution completed successfully');
      }

      set({ isRunning: false, currentNodeIds: [], _abortController: null });

      // Save logs to server
      const session = logger.getCurrentSession();
      if (session) {
        session.endTime = new Date().toISOString();
        fetch('/api/logs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session,
            projectId: get().projectId,
            workflowId: get().workflowId,
            nodeCount: get().nodes.length,
            cost: get().incurredCost,
            status: 'success',
          }),
        }).catch((err) => {
          console.error('Failed to save log session:', err);
        });
      }

      await logger.endSession();
    } catch (error) {
      // Handle AbortError gracefully (user cancelled)
      if (error instanceof DOMException && error.name === 'AbortError') {
        logger.info('workflow.end', 'Workflow execution cancelled by user');
      } else {
        logger.error('workflow.error', 'Workflow execution failed', {}, error instanceof Error ? error : undefined);
        // Show error toast for the failed node
        useToast.getState().show(
          `Workflow failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          "error"
        );
      }
      set({ isRunning: false, currentNodeIds: [], _abortController: null });

      // Save logs to server (even on error)
      const session = logger.getCurrentSession();
      if (session) {
        session.endTime = new Date().toISOString();
        fetch('/api/logs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session,
            projectId: get().projectId,
            workflowId: get().workflowId,
            nodeCount: get().nodes.length,
            cost: get().incurredCost,
            status: 'error',
            error: error instanceof Error ? error.message : 'Workflow execution failed',
          }),
        }).catch((err) => {
          console.error('Failed to save log session:', err);
        });
      }

      await logger.endSession();
    }
  },

  stopWorkflow: () => {
    // Abort any in-flight requests
    const controller = get()._abortController;
    if (controller) {
      controller.abort();
    }
    set({ isRunning: false, currentNodeIds: [], _abortController: null });
  },

  setMaxConcurrentCalls: (value: number) => {
    const clamped = Math.max(1, Math.min(10, value));
    saveConcurrencySetting(clamped);
    set({ maxConcurrentCalls: clamped });
  },

  regenerateNode: async (nodeId: string) => {
    const { nodes, updateNodeData, getConnectedInputs, isRunning } = get();

    if (isRunning) {
      logger.warn('node.execution', 'Cannot regenerate node, workflow already running', { nodeId });
      return;
    }

    const node = nodes.find((n) => n.id === nodeId);
    if (!node) {
      logger.warn('node.error', 'Node not found for regeneration', { nodeId });
      return;
    }

    set({ isRunning: true, currentNodeIds: [nodeId] });

    await logger.startSession();
    logger.info('node.execution', 'Regenerating node', {
      nodeId,
      nodeType: node.type,
    });

    try {
      if (node.type === "nanoBanana") {
        // Get fresh node data from store
        const freshNode = get().nodes.find((n) => n.id === nodeId);
        const nodeData = (freshNode?.data || node.data) as NanoBananaNodeData;
        const providerSettingsState = get().providerSettings;
        const provider = nodeData.selectedModel?.provider || "gemini";

        // Always get fresh connected inputs first, fall back to stored inputs only if not connected
        const { images: connectedImages, text: connectedText, dynamicInputs } = getConnectedInputs(nodeId);
        const images = connectedImages.length > 0 ? connectedImages : nodeData.inputImages;
        const text = connectedText ?? nodeData.inputPrompt;

        if (!text) {
          logger.error('node.error', 'Generate node regeneration failed: missing text input', {
            nodeId,
            provider,
          });
          updateNodeData(nodeId, {
            status: "error",
            error: "Missing text input",
          });
          set({ isRunning: false, currentNodeIds: [] });
          await logger.endSession();
          return;
        }

        updateNodeData(nodeId, {
          status: "loading",
          error: null,
        });

        // Build headers with API keys for providers
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (provider === "gemini") {
          const geminiConfig = providerSettingsState.providers.gemini;
          if (geminiConfig?.apiKey) {
            headers["X-Gemini-API-Key"] = geminiConfig.apiKey;
          }
        } else if (provider === "replicate") {
          const replicateConfig = providerSettingsState.providers.replicate;
          if (replicateConfig?.apiKey) {
            headers["X-Replicate-API-Key"] = replicateConfig.apiKey;
          }
        } else if (provider === "fal") {
          const falConfig = providerSettingsState.providers.fal;
          if (falConfig?.apiKey) {
            headers["X-Fal-API-Key"] = falConfig.apiKey;
          }
        } else if (provider === "kie") {
          const kieConfig = providerSettingsState.providers.kie;
          if (kieConfig?.apiKey) {
            headers["X-Kie-Key"] = kieConfig.apiKey;
          }
        } else if (provider === "wavespeed") {
          const wavespeedConfig = providerSettingsState.providers.wavespeed;
          if (wavespeedConfig?.apiKey) {
            headers["X-WaveSpeed-Key"] = wavespeedConfig.apiKey;
          }
        }

        logger.info('node.execution', `Calling ${provider} API for node regeneration`, {
          nodeId,
          provider,
          model: nodeData.selectedModel?.modelId || nodeData.model,
          aspectRatio: nodeData.aspectRatio,
          resolution: nodeData.resolution,
          imageCount: images.length,
          prompt: text,
        });

        let response: Response;
        try {
          response = await fetch("/api/generate", {
            method: "POST",
            headers,
            body: JSON.stringify({
              images,
              prompt: text,
              aspectRatio: nodeData.aspectRatio,
              resolution: nodeData.resolution,
              model: nodeData.model,
              useGoogleSearch: nodeData.useGoogleSearch,
              selectedModel: nodeData.selectedModel,
              parameters: nodeData.parameters,
              dynamicInputs,  // Pass dynamic inputs for schema-mapped connections
            }),
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.error('api.error', `${provider} API regeneration failed`, {
            nodeId,
            provider,
            errorMessage: message,
          }, err instanceof Error ? err : undefined);
          updateNodeData(nodeId, { status: "error", error: message });
          set({ isRunning: false, currentNodeIds: [] });
          await logger.endSession();
          return;
        }

        if (!response.ok) {
          const errorText = await response.text();
          let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
          try {
            const errorJson = JSON.parse(errorText);
            errorMessage = errorJson.error || errorMessage;
          } catch {
            if (errorText) errorMessage += ` - ${errorText.substring(0, 200)}`;
          }
          logger.error('api.error', `${provider} API regeneration failed`, {
            nodeId,
            provider,
            status: response.status,
            statusText: response.statusText,
            errorMessage,
          });
          updateNodeData(nodeId, { status: "error", error: errorMessage });
          set({ isRunning: false, currentNodeIds: [] });
          await logger.endSession();
          return;
        }

        const result = await response.json();
        if (result.success && result.image) {
          const timestamp = Date.now();
          const imageId = `${timestamp}`;

          // Save the newly generated image to global history
          get().addToGlobalHistory({
            image: result.image,
            timestamp,
            prompt: text,
            aspectRatio: nodeData.aspectRatio,
            model: nodeData.model,
          });

          // Add to node's carousel history
          const newHistoryItem = {
            id: imageId,
            timestamp,
            prompt: text,
            aspectRatio: nodeData.aspectRatio,
            model: nodeData.model,
          };
          const updatedHistory = [newHistoryItem, ...(nodeData.imageHistory || [])];

          updateNodeData(nodeId, {
            outputImage: result.image,
            status: "complete",
            error: null,
            imageHistory: updatedHistory,
            selectedHistoryIndex: 0,
          });

          // Push new image to connected downstream outputGallery nodes
          get().edges
            .filter(e => e.source === nodeId)
            .forEach(e => {
              const target = get().nodes.find(n => n.id === e.target);
              if (target?.type === "outputGallery") {
                const gData = target.data as OutputGalleryNodeData;
                updateNodeData(target.id, {
                  images: [result.image, ...(gData.images || [])],
                });
              }
            });

          // Track cost
          // Cost tracking: Gemini (hardcoded), fal.ai (from API). Replicate excluded (no pricing API).
          if (nodeData.selectedModel?.provider === "fal" && nodeData.selectedModel?.pricing) {
            get().addIncurredCost(nodeData.selectedModel.pricing.amount);
          } else if (!nodeData.selectedModel || nodeData.selectedModel.provider === "gemini") {
            const generationCost = calculateGenerationCost(nodeData.model, nodeData.resolution);
            get().addIncurredCost(generationCost);
          }

          // Auto-save to generations folder if configured
          const genPath = get().generationsPath;
          if (genPath) {
            trackSaveGeneration(genPath, { image: result.image }, text, imageId, nodeId, 'image', get, updateNodeData);
          }
        } else {
          updateNodeData(nodeId, {
            status: "error",
            error: result.error || "Generation failed",
          });
        }
      } else if (node.type === "llmGenerate") {
        const nodeData = node.data as LLMGenerateNodeData;

        // Always get fresh connected inputs first, fall back to stored inputs only if not connected
        const inputs = getConnectedInputs(nodeId);
        const images = inputs.images.length > 0 ? inputs.images : nodeData.inputImages;
        const text = inputs.text ?? nodeData.inputPrompt;

        if (!text) {
          logger.error('node.error', 'llmGenerate regeneration failed: missing text input', {
            nodeId,
          });
          updateNodeData(nodeId, {
            status: "error",
            error: "Missing text input",
          });
          set({ isRunning: false, currentNodeIds: [] });
          await logger.endSession();
          return;
        }

        updateNodeData(nodeId, {
          inputImages: images,
          status: "loading",
          error: null,
        });

        const providerSettingsState = get().providerSettings;

        // Build headers with API keys for LLM providers
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (nodeData.provider === "google") {
          const geminiConfig = providerSettingsState.providers.gemini;
          if (geminiConfig?.apiKey) {
            headers["X-Gemini-API-Key"] = geminiConfig.apiKey;
          }
        } else if (nodeData.provider === "openai") {
          const openaiConfig = providerSettingsState.providers.openai;
          if (openaiConfig?.apiKey) {
            headers["X-OpenAI-API-Key"] = openaiConfig.apiKey;
          }
        }

        logger.info('api.llm', 'Calling LLM API for node regeneration', {
          nodeId,
          provider: nodeData.provider,
          model: nodeData.model,
          temperature: nodeData.temperature,
          maxTokens: nodeData.maxTokens,
          hasImages: images.length > 0,
          prompt: text,
        });

        const response = await fetch("/api/llm", {
          method: "POST",
          headers,
          body: JSON.stringify({
            prompt: text,
            ...(images.length > 0 && { images }),
            systemPrompt: nodeData.systemPrompt,
            provider: nodeData.provider,
            model: nodeData.model,
            temperature: nodeData.temperature,
            maxTokens: nodeData.maxTokens,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          let errorMessage = `HTTP ${response.status}`;
          try {
            const errorJson = JSON.parse(errorText);
            errorMessage = errorJson.error || errorMessage;
          } catch {
            if (errorText) errorMessage += ` - ${errorText.substring(0, 200)}`;
          }
          logger.error('api.error', 'LLM API regeneration failed', {
            nodeId,
            status: response.status,
            errorMessage,
          });
          updateNodeData(nodeId, { status: "error", error: errorMessage });
          set({ isRunning: false, currentNodeIds: [] });
          await logger.endSession();
          return;
        }

        const result = await response.json();
        if (result.success && result.text) {
          updateNodeData(nodeId, {
            outputText: result.text,
            status: "complete",
            error: null,
          });
        } else {
          logger.error('api.error', 'LLM regeneration failed', {
            nodeId,
            error: result.error,
          });
          updateNodeData(nodeId, {
            status: "error",
            error: result.error || "LLM generation failed",
          });
        }
      } else if (node.type === "generateVideo") {
        // Get fresh node data from store
        const freshVideoNode = get().nodes.find((n) => n.id === nodeId);
        const nodeData = (freshVideoNode?.data || node.data) as GenerateVideoNodeData;
        const providerSettingsState = get().providerSettings;

        // Get fresh connected inputs
        const { images: connectedImages, text: connectedText, dynamicInputs } = getConnectedInputs(nodeId);
        const images = connectedImages.length > 0 ? connectedImages : nodeData.inputImages;
        const text = connectedText ?? nodeData.inputPrompt;

        if (!text) {
          logger.error('node.error', 'generateVideo regeneration failed: missing text input', {
            nodeId,
          });
          updateNodeData(nodeId, {
            status: "error",
            error: "Missing text input",
          });
          set({ isRunning: false, currentNodeIds: [] });
          await logger.endSession();
          return;
        }

        if (!nodeData.selectedModel?.modelId) {
          logger.error('node.error', 'generateVideo regeneration failed: no model selected', {
            nodeId,
          });
          updateNodeData(nodeId, {
            status: "error",
            error: "No model selected",
          });
          set({ isRunning: false, currentNodeIds: [] });
          await logger.endSession();
          return;
        }

        updateNodeData(nodeId, {
          inputImages: images,
          status: "loading",
          error: null,
        });

        // Build headers with API keys for providers
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        const provider = nodeData.selectedModel.provider;
        if (provider === "gemini") {
          const geminiConfig = providerSettingsState.providers.gemini;
          if (geminiConfig?.apiKey) {
            headers["X-Gemini-API-Key"] = geminiConfig.apiKey;
          }
        } else if (provider === "replicate") {
          const replicateConfig = providerSettingsState.providers.replicate;
          if (replicateConfig?.apiKey) {
            headers["X-Replicate-API-Key"] = replicateConfig.apiKey;
          }
        } else if (provider === "fal") {
          const falConfig = providerSettingsState.providers.fal;
          if (falConfig?.apiKey) {
            headers["X-Fal-API-Key"] = falConfig.apiKey;
          }
        } else if (provider === "kie") {
          const kieConfig = providerSettingsState.providers.kie;
          if (kieConfig?.apiKey) {
            headers["X-Kie-Key"] = kieConfig.apiKey;
          }
        } else if (provider === "wavespeed") {
          const wavespeedConfig = providerSettingsState.providers.wavespeed;
          if (wavespeedConfig?.apiKey) {
            headers["X-WaveSpeed-Key"] = wavespeedConfig.apiKey;
          }
        }
        logger.info('node.execution', `Calling ${provider} API for video regeneration`, {
          nodeId,
          provider,
          model: nodeData.selectedModel.modelId,
          imageCount: images.length,
          prompt: text,
        });

        const response = await fetch("/api/generate", {
          method: "POST",
          headers,
          body: JSON.stringify({
            images,
            prompt: text,
            selectedModel: nodeData.selectedModel,
            parameters: nodeData.parameters,
            dynamicInputs,
            mediaType: "video",  // Signal to API to use queue for long-running video generation
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          let errorMessage = `HTTP ${response.status}`;
          try {
            const errorJson = JSON.parse(errorText);
            errorMessage = errorJson.error || errorMessage;
          } catch {
            if (errorText) errorMessage += ` - ${errorText.substring(0, 200)}`;
          }
          logger.error('api.error', `${provider} API video regeneration failed`, {
            nodeId,
            provider,
            status: response.status,
            errorMessage,
          });
          updateNodeData(nodeId, { status: "error", error: errorMessage });
          set({ isRunning: false, currentNodeIds: [] });
          await logger.endSession();
          return;
        }

        const result = await response.json();
        const videoData = result.video || result.videoUrl;
        if (result.success && videoData) {
          const timestamp = Date.now();
          const videoId = `${timestamp}`;

          // Add to node's video history
          const newHistoryItem = {
            id: videoId,
            timestamp,
            prompt: text || '',
            model: nodeData.selectedModel?.modelId || '',
          };
          const updatedHistory = [newHistoryItem, ...(nodeData.videoHistory || [])].slice(0, 50);

          updateNodeData(nodeId, {
            outputVideo: videoData,
            outputTaskId: result.taskId || null,
            status: "complete",
            error: null,
            videoHistory: updatedHistory,
            selectedVideoHistoryIndex: 0,
          });

          // Track cost for video regeneration
          // Cost tracking: fal.ai (from API). Replicate excluded (no pricing API).
          if (nodeData.selectedModel?.provider === "fal" && nodeData.selectedModel?.pricing) {
            get().addIncurredCost(nodeData.selectedModel.pricing.amount);
          }

          // Auto-save video to generations folder if configured
          const genPath = get().generationsPath;
          if (genPath) {
            trackSaveGeneration(genPath, { video: videoData }, text, videoId, nodeId, 'video', get, updateNodeData);
          }
        } else if (result.success && result.image) {
          const timestamp = Date.now();
          const videoId = `${timestamp}`;

          // Add to node's video history
          const newHistoryItem = {
            id: videoId,
            timestamp,
            prompt: text || '',
            model: nodeData.selectedModel?.modelId || '',
          };
          const updatedHistory = [newHistoryItem, ...(nodeData.videoHistory || [])].slice(0, 50);

          updateNodeData(nodeId, {
            outputVideo: result.image,
            outputTaskId: result.taskId || null,
            status: "complete",
            error: null,
            videoHistory: updatedHistory,
            selectedVideoHistoryIndex: 0,
          });

          // Track cost for video regeneration (image fallback case)
          // Cost tracking: fal.ai (from API). Replicate excluded (no pricing API).
          if (nodeData.selectedModel?.provider === "fal" && nodeData.selectedModel?.pricing) {
            get().addIncurredCost(nodeData.selectedModel.pricing.amount);
          }

          // Auto-save image preview to generations folder if configured
          const genPath = get().generationsPath;
          if (genPath) {
            trackSaveGeneration(genPath, { image: result.image }, text, videoId, nodeId, 'video', get, updateNodeData);
          }
        } else {
          logger.error('api.error', `${provider} API video regeneration failed`, {
            nodeId,
            provider,
            error: result.error,
          });
          updateNodeData(nodeId, {
            status: "error",
            error: result.error || "Video generation failed",
          });
        }
      } else if (node.type === "veoReferenceVideo") {
        const nodeData = node.data as VeoReferenceVideoNodeData;
        const { images, text } = getConnectedInputs(nodeId);
        const promptText = text || nodeData.inputPrompt || null;

        if (!promptText || images.length === 0) {
          updateNodeData(nodeId, {
            status: "error",
            error: "Missing required inputs",
          });
          set({ isRunning: false, currentNodeIds: [] });
          await logger.endSession();
          return;
        }

        updateNodeData(nodeId, {
          inputImages: images,
          inputPrompt: promptText,
          status: "loading",
          error: null,
        });

        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        const kieConfig = get().providerSettings.providers.kie;
        if (kieConfig?.apiKey) {
          headers["X-Kie-Key"] = kieConfig.apiKey;
        }

        const response = await fetch("/api/generate", {
          method: "POST",
          headers,
          body: JSON.stringify({
            prompt: promptText,
            images,
            parameters: nodeData.parameters,
            veoOperation: "reference",
            mediaType: "video",
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          let errorMessage = `HTTP ${response.status}`;
          try {
            const errorJson = JSON.parse(errorText);
            errorMessage = errorJson.error || errorMessage;
          } catch {
            if (errorText) errorMessage += ` - ${errorText.substring(0, 200)}`;
          }
          updateNodeData(nodeId, { status: "error", error: errorMessage });
          set({ isRunning: false, currentNodeIds: [] });
          await logger.endSession();
          return;
        }

        const result = await response.json();
        const videoData = result.video || result.videoUrl;
        if (result.success && videoData) {
          updateNodeData(nodeId, {
            outputVideo: videoData,
            outputTaskId: result.taskId || null,
            status: "complete",
            error: null,
          });
        } else {
          updateNodeData(nodeId, {
            status: "error",
            error: result.error || "Veo reference failed",
          });
        }
      } else if (node.type === "veoExtendVideo") {
        const nodeData = node.data as VeoExtendVideoNodeData;
        const { text, taskId } = getConnectedInputs(nodeId);
        const promptText = text || nodeData.inputPrompt || null;
        const taskIdValue = taskId || nodeData.inputTaskId || null;

        if (!promptText || !taskIdValue) {
          updateNodeData(nodeId, {
            status: "error",
            error: "Missing required inputs",
          });
          set({ isRunning: false, currentNodeIds: [] });
          await logger.endSession();
          return;
        }

        updateNodeData(nodeId, {
          inputPrompt: promptText,
          inputTaskId: taskIdValue,
          status: "loading",
          error: null,
        });

        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        const kieConfig = get().providerSettings.providers.kie;
        if (kieConfig?.apiKey) {
          headers["X-Kie-Key"] = kieConfig.apiKey;
        }

        const response = await fetch("/api/generate", {
          method: "POST",
          headers,
          body: JSON.stringify({
            prompt: promptText,
            taskId: taskIdValue,
            parameters: nodeData.parameters,
            veoOperation: "extend",
            mediaType: "video",
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          let errorMessage = `HTTP ${response.status}`;
          try {
            const errorJson = JSON.parse(errorText);
            errorMessage = errorJson.error || errorMessage;
          } catch {
            if (errorText) errorMessage += ` - ${errorText.substring(0, 200)}`;
          }
          updateNodeData(nodeId, { status: "error", error: errorMessage });
          set({ isRunning: false, currentNodeIds: [] });
          await logger.endSession();
          return;
        }

        const result = await response.json();
        const videoData = result.video || result.videoUrl;
        if (result.success && videoData) {
          updateNodeData(nodeId, {
            outputVideo: videoData,
            outputTaskId: result.taskId || null,
            status: "complete",
            error: null,
          });
        } else {
          updateNodeData(nodeId, {
            status: "error",
            error: result.error || "Veo extend failed",
          });
        }
      } else if (node.type === "veo1080pVideo" || node.type === "veo4kVideo") {
        const nodeData = node.data as Veo1080pVideoNodeData | Veo4kVideoNodeData;
        const { taskId } = getConnectedInputs(nodeId);
        const taskIdValue = taskId || nodeData.inputTaskId || null;

        if (!taskIdValue) {
          updateNodeData(nodeId, {
            status: "error",
            error: "Missing required inputs",
          });
          set({ isRunning: false, currentNodeIds: [] });
          await logger.endSession();
          return;
        }

        updateNodeData(nodeId, {
          inputTaskId: taskIdValue,
          status: "loading",
          error: null,
        });

        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        const kieConfig = get().providerSettings.providers.kie;
        if (kieConfig?.apiKey) {
          headers["X-Kie-Key"] = kieConfig.apiKey;
        }

        const operation = node.type === "veo1080pVideo" ? "get1080p" : "get4k";
        const response = await fetch("/api/generate", {
          method: "POST",
          headers,
          body: JSON.stringify({
            taskId: taskIdValue,
            parameters: nodeData.parameters,
            veoOperation: operation,
            mediaType: "video",
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          let errorMessage = `HTTP ${response.status}`;
          try {
            const errorJson = JSON.parse(errorText);
            errorMessage = errorJson.error || errorMessage;
          } catch {
            if (errorText) errorMessage += ` - ${errorText.substring(0, 200)}`;
          }
          updateNodeData(nodeId, { status: "error", error: errorMessage });
          set({ isRunning: false, currentNodeIds: [] });
          await logger.endSession();
          return;
        }

        const result = await response.json();
        const videoData = result.video || result.videoUrl;
        if (result.success && videoData) {
          updateNodeData(nodeId, {
            outputVideo: videoData,
            outputTaskId: result.taskId || taskIdValue,
            status: "complete",
            error: null,
          });
        } else {
          updateNodeData(nodeId, {
            status: "error",
            error: result.error || "Veo upscale failed",
          });
        }
      } else if (node.type === "splitGrid") {
        const nodeData = node.data as SplitGridNodeData;

        // Get fresh connected inputs
        const inputs = getConnectedInputs(nodeId);
        const sourceImage = inputs.images[0] || null;

        if (!sourceImage) {
          logger.error('node.error', 'splitGrid regeneration failed: no input image', {
            nodeId,
          });
          updateNodeData(nodeId, {
            status: "error",
            error: "No input image connected",
          });
          set({ isRunning: false, currentNodeIds: [] });
          await logger.endSession();
          return;
        }

        if (!nodeData.isConfigured) {
          logger.error('node.error', 'splitGrid regeneration failed: not configured', {
            nodeId,
          });
          updateNodeData(nodeId, {
            status: "error",
            error: "Node not configured - open settings first",
          });
          set({ isRunning: false, currentNodeIds: [] });
          await logger.endSession();
          return;
        }

        updateNodeData(nodeId, {
          sourceImage,
          status: "loading",
          error: null,
        });

        logger.info('node.execution', 'Splitting grid manually', {
          nodeId,
          gridRows: nodeData.gridRows,
          gridCols: nodeData.gridCols,
          childCount: nodeData.childNodeIds.length,
        });

        try {
          // Import and use the grid splitter
          const { splitWithDimensions } = await import("@/utils/gridSplitter");
          const { images: splitImages } = await splitWithDimensions(
            sourceImage,
            nodeData.gridRows,
            nodeData.gridCols
          );

          // Populate child imageInput nodes with split images
          for (let index = 0; index < nodeData.childNodeIds.length; index++) {
            const childSet = nodeData.childNodeIds[index];
            if (splitImages[index]) {
              // Create a promise to get image dimensions
              await new Promise<void>((resolve) => {
                const img = new Image();
                img.onload = () => {
                  updateNodeData(childSet.imageInput, {
                    image: splitImages[index],
                    filename: `split-${Math.floor(index / nodeData.gridCols) + 1}-${(index % nodeData.gridCols) + 1}.png`,
                    dimensions: { width: img.width, height: img.height },
                  });
                  resolve();
                };
                img.onerror = () => resolve();
                img.src = splitImages[index];
              });
            }
          }

          logger.info('node.execution', 'Grid split completed successfully', {
            nodeId,
            splitCount: splitImages.length,
          });
          updateNodeData(nodeId, { status: "complete", error: null });
        } catch (error) {
          logger.error('node.error', 'splitGrid manual execution failed', {
            nodeId,
          }, error instanceof Error ? error : undefined);
          updateNodeData(nodeId, {
            status: "error",
            error: error instanceof Error ? error.message : "Failed to split image",
          });
          set({ isRunning: false, currentNodeIds: [] });
          await logger.endSession();
          return;
        }
      } else if (node.type === "videoStitch") {
        const nodeData = node.data as VideoStitchNodeData;

        if (nodeData.encoderSupported === false) {
          updateNodeData(nodeId, {
            status: "error",
            error: "Browser does not support video encoding",
            progress: 0,
          });
          set({ isRunning: false, currentNodeIds: [] });
          await logger.endSession();
          return;
        }

        updateNodeData(nodeId, { status: "loading", progress: 0, error: null });

        try {
          const inputs = getConnectedInputs(nodeId);

          if (inputs.videos.length < 2) {
            updateNodeData(nodeId, {
              status: "error",
              error: "Need at least 2 video clips to stitch",
              progress: 0,
            });
            set({ isRunning: false, currentNodeIds: [] });
            await logger.endSession();
            return;
          }

          const videoBlobs = await Promise.all(
            inputs.videos.map((v) => fetch(v).then((r) => r.blob()))
          );

          let audioData = null;
          if (inputs.audio.length > 0 && inputs.audio[0]) {
            const { prepareAudioAsync } = await import('@/hooks/useAudioMixing');
            const audioUrl = inputs.audio[0];
            const audioResponse = await fetch(audioUrl);
            const rawBlob = await audioResponse.blob();
            // Ensure the blob has the correct MIME type for MediaBunny format detection
            const audioMime = rawBlob.type || (audioUrl.startsWith('data:') ? audioUrl.split(';')[0].split(':')[1] : 'audio/mpeg');
            const audioBlob = rawBlob.type ? rawBlob : new Blob([rawBlob], { type: audioMime });
            audioData = await prepareAudioAsync(audioBlob, 0);
          }

          const { stitchVideosAsync } = await import('@/hooks/useStitchVideos');
          const outputBlob = await stitchVideosAsync(
            videoBlobs,
            audioData,
            (progress) => {
              updateNodeData(nodeId, { progress: progress.progress });
            }
          );

          // Revoke old blob URL before replacing
          const oldStitchData = get().nodes.find(n => n.id === nodeId)?.data as Record<string, unknown> | undefined;
          revokeBlobUrl(oldStitchData?.outputVideo as string | undefined);

          let outputVideo: string;
          if (outputBlob.size > 20 * 1024 * 1024) {
            outputVideo = URL.createObjectURL(outputBlob);
          } else {
            const reader = new FileReader();
            outputVideo = await new Promise<string>((resolve) => {
              reader.onload = () => resolve(reader.result as string);
              reader.readAsDataURL(outputBlob);
            });
          }

          updateNodeData(nodeId, {
            outputVideo,
            status: "complete",
            progress: 100,
            error: null,
          });
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : "Stitch failed";
          updateNodeData(nodeId, {
            status: "error",
            error: errorMessage,
            progress: 0,
          });
        }
      } else if (node.type === "easeCurve") {
        const nodeData = node.data as EaseCurveNodeData;

        if (nodeData.encoderSupported === false) {
          updateNodeData(nodeId, {
            status: "error",
            error: "Browser does not support video encoding",
            progress: 0,
          });
          set({ isRunning: false, currentNodeIds: [] });
          await logger.endSession();
          return;
        }

        updateNodeData(nodeId, { status: "loading", progress: 0, error: null });

        try {
          const inputs = getConnectedInputs(nodeId);

          // Propagate parent easeCurve settings if inherited
          let activeBezierHandles = nodeData.bezierHandles;
          let activeEasingPreset = nodeData.easingPreset;
          if (inputs.easeCurve) {
            activeBezierHandles = inputs.easeCurve.bezierHandles;
            activeEasingPreset = inputs.easeCurve.easingPreset;
            const { edges } = get();
            const easeCurveSourceId = edges.filter(
              (e) => e.target === nodeId && e.targetHandle === "easeCurve"
            )[0]?.source ?? null;
            updateNodeData(nodeId, {
              bezierHandles: activeBezierHandles,
              easingPreset: activeEasingPreset,
              inheritedFrom: easeCurveSourceId,
            });
          }

          if (inputs.videos.length === 0) {
            updateNodeData(nodeId, {
              status: "error",
              error: "Connect a video input to apply ease curve",
              progress: 0,
            });
            set({ isRunning: false, currentNodeIds: [] });
            await logger.endSession();
            return;
          }

          const videoUrl = inputs.videos[0];
          const videoBlob = await fetch(videoUrl).then((r) => r.blob());

          const videoDuration = await new Promise<number>((resolve) => {
            const video = document.createElement("video");
            video.preload = "metadata";
            video.onloadedmetadata = () => {
              resolve(video.duration);
              URL.revokeObjectURL(video.src);
            };
            video.onerror = () => {
              resolve(5);
              URL.revokeObjectURL(video.src);
            };
            video.src = URL.createObjectURL(videoBlob);
          });

          let easingFunction: string | ((t: number) => number);
          if (activeEasingPreset) {
            easingFunction = activeEasingPreset;
          } else {
            const { createBezierEasing } = await import('@/lib/easing-functions');
            easingFunction = createBezierEasing(
              activeBezierHandles[0],
              activeBezierHandles[1],
              activeBezierHandles[2],
              activeBezierHandles[3]
            );
          }

          const { applySpeedCurveAsync } = await import('@/hooks/useApplySpeedCurve');
          const outputBlob = await applySpeedCurveAsync(
            videoBlob,
            videoDuration,
            nodeData.outputDuration,
            (progress) => {
              updateNodeData(nodeId, { progress: progress.progress });
            },
            easingFunction
          );

          if (!outputBlob) {
            throw new Error("Speed curve processing returned no output");
          }

          // Revoke old blob URL before replacing
          const oldEaseData = get().nodes.find(n => n.id === nodeId)?.data as Record<string, unknown> | undefined;
          revokeBlobUrl(oldEaseData?.outputVideo as string | undefined);

          let outputVideo: string;
          if (outputBlob.size > 20 * 1024 * 1024) {
            outputVideo = URL.createObjectURL(outputBlob);
          } else {
            const reader = new FileReader();
            outputVideo = await new Promise<string>((resolve) => {
              reader.onload = () => resolve(reader.result as string);
              reader.readAsDataURL(outputBlob);
            });
          }

          updateNodeData(nodeId, {
            outputVideo,
            status: "complete",
            progress: 100,
            error: null,
          });
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : "Ease curve processing failed";
          updateNodeData(nodeId, {
            status: "error",
            error: errorMessage,
            progress: 0,
          });
        }

        set({ isRunning: false, currentNodeIds: [] });
        await logger.endSession();
        return;
      }

      logger.info('node.execution', 'Node regeneration completed successfully', { nodeId });
      set({ isRunning: false, currentNodeIds: [] });

      // Save logs to server
      const session = logger.getCurrentSession();
      if (session) {
        session.endTime = new Date().toISOString();
        fetch('/api/logs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session,
            projectId: get().projectId,
            workflowId: get().workflowId,
            nodeCount: 1,
            cost: get().incurredCost,
            status: 'success',
          }),
        }).catch((err) => {
          console.error('Failed to save log session:', err);
        });
      }

      await logger.endSession();
    } catch (error) {
      logger.error('node.error', 'Node regeneration failed', {
        nodeId,
      }, error instanceof Error ? error : undefined);
      updateNodeData(nodeId, {
        status: "error",
        error: error instanceof Error ? error.message : "Regeneration failed",
      });
      set({ isRunning: false, currentNodeIds: [] });

      // Save logs to server (even on error)
      const session = logger.getCurrentSession();
      if (session) {
        session.endTime = new Date().toISOString();
        fetch('/api/logs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session,
            projectId: get().projectId,
            workflowId: get().workflowId,
            nodeCount: 1,
            cost: get().incurredCost,
            status: 'error',
            error: error instanceof Error ? error.message : 'Node regeneration failed',
          }),
        }).catch((err) => {
          console.error('Failed to save log session:', err);
        });
      }

      await logger.endSession();
    }
  },

  saveWorkflow: (name?: string) => {
    const { nodes, edges, edgeStyle, groups } = get();

    const workflow: WorkflowFile = {
      version: 1,
      name: name || `workflow-${new Date().toISOString().slice(0, 10)}`,
      // Strip selected property - selection is transient UI state and should not be persisted
      nodes: nodes.map(({ selected, ...rest }) => rest),
      edges,
      edgeStyle,
      groups: groups && Object.keys(groups).length > 0 ? groups : undefined,
    };

    const json = JSON.stringify(workflow, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = `${workflow.name}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  },

  loadWorkflow: async (workflow: WorkflowFile, workflowPath?: string, options?: { preserveSnapshot?: boolean }) => {
    // Update nodeIdCounter to avoid ID collisions
    const maxNodeId = workflow.nodes.reduce((max, node) => {
      const match = node.id.match(/-(\d+)$/);
      if (match) {
        return Math.max(max, parseInt(match[1], 10));
      }
      return max;
    }, 0);
    nodeIdCounter = maxNodeId;

    // Update groupIdCounter to avoid ID collisions
    const maxGroupId = Object.keys(workflow.groups || {}).reduce((max, id) => {
      const match = id.match(/-(\d+)$/);
      if (match) {
        return Math.max(max, parseInt(match[1], 10));
      }
      return max;
    }, 0);
    groupIdCounter = maxGroupId;

    // Migrate legacy nanoBanana nodes: derive selectedModel from model field if missing
    workflow.nodes = workflow.nodes.map((node) => {
      if (node.type === "nanoBanana") {
        const data = node.data as NanoBananaNodeData;
        if (data.model && !data.selectedModel) {
          const displayName = data.model === "nano-banana" ? "Nano Banana" : "Nano Banana Pro";
          return {
            ...node,
            data: {
              ...data,
              selectedModel: {
                provider: "gemini" as ProviderType,
                modelId: data.model,
                displayName,
              },
            },
          };
        }
      }
      return node;
    }) as WorkflowNode[];

    // Look up saved config from localStorage (only if workflow has an ID)
    const configs = loadSaveConfigs();
    const savedConfig = workflow.id ? configs[workflow.id] : null;
    const savedProjectId = savedConfig?.projectId || null;

    // Determine the workflow directory path (passed in or from saved config)
    const directoryPath = workflowPath || savedConfig?.directoryPath || null;
    const generationsPath =
      savedConfig?.generationsPath ||
      (savedProjectId ? getProjectGenerationsPublicPath(savedProjectId) : null);

    // Hydrate images if we have a directory path and the workflow has image refs
    let hydratedWorkflow = workflow;
    if (directoryPath) {
      try {
        hydratedWorkflow = await hydrateWorkflowImages(workflow, directoryPath);
      } catch (error) {
        console.error("Failed to hydrate workflow images:", error);
        // Continue with original workflow if hydration fails
      }
    }

    // Load cost data for this workflow
    const costData = workflow.id ? loadWorkflowCostData(workflow.id) : null;

    set({
      // Clear selected state - selection should not be persisted across sessions
      // Also validate position to ensure coordinates are finite numbers
      nodes: hydratedWorkflow.nodes.map(node => ({
        ...node,
        selected: false,
        position: {
          x: isFinite(node.position?.x) ? node.position.x : 0,
          y: isFinite(node.position?.y) ? node.position.y : 0,
        },
      })),
      edges: hydratedWorkflow.edges,
      edgeStyle: hydratedWorkflow.edgeStyle || "angular",
      groups: hydratedWorkflow.groups || {},
      isRunning: false,
      currentNodeIds: [],
      // Restore workflow ID and paths from localStorage if available
      projectId: savedProjectId,
      workflowId: workflow.id || null,
      workflowName: workflow.name,
      saveDirectoryPath: directoryPath,
      generationsPath,
      lastSavedAt: savedConfig?.lastSavedAt || null,
      hasUnsavedChanges: false,
      // Restore cost data
      incurredCost: costData?.incurredCost || 0,
      // Track where imageRefs are valid from
      imageRefBasePath: directoryPath,
      // Restore image storage setting (default to true for backwards compatibility)
      useExternalImageStorage: savedConfig?.useExternalImageStorage ?? true,
      // Reset viewed comments when loading new workflow
      viewedCommentNodeIds: new Set<string>(),
    });

    // Clear snapshot unless explicitly preserving (e.g., AI workflow generation)
    if (!options?.preserveSnapshot) {
      get().clearSnapshot();
    }
  },

  clearWorkflow: () => {
    set({
      nodes: [],
      edges: [],
      groups: {},
      isRunning: false,
      currentNodeIds: [],
      // Reset auto-save state when clearing workflow
      projectId: null,
      workflowId: null,
      workflowName: null,
      saveDirectoryPath: null,
      generationsPath: null,
      lastSavedAt: null,
      hasUnsavedChanges: false,
      // Reset cost tracking
      incurredCost: 0,
      // Reset imageRef tracking
      imageRefBasePath: null,
      // Reset viewed comments when clearing workflow
      viewedCommentNodeIds: new Set<string>(),
    });
    get().clearSnapshot();
  },

  addToGlobalHistory: (item: Omit<ImageHistoryItem, "id">) => {
    const newItem: ImageHistoryItem = {
      ...item,
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    };

    set((state) => ({
      globalImageHistory: [newItem, ...state.globalImageHistory],
    }));
  },

  clearGlobalHistory: () => {
    set({ globalImageHistory: [] });
  },

  // Auto-save actions
  setWorkflowMetadata: (
    id: string,
    name: string,
    path: string,
    generationsPath?: string | null,
    projectId?: string | null
  ) => {
    // Auto-derive generationsPath: use provided value, fall back to existing, then auto-derive
    const currentGenPath = get().generationsPath;
    const normalizedPath = path.trim();
    const normalizedProjectId = projectId ? projectId.trim() : null;
    const projectGenerationsPath = normalizedProjectId
      ? getProjectGenerationsPublicPath(normalizedProjectId)
      : null;
    const derivedGenerationsPath =
      generationsPath ??
      currentGenPath ??
      (normalizedPath ? `${normalizedPath}/generations` : projectGenerationsPath);

    set({
      projectId: normalizedProjectId,
      workflowId: id,
      workflowName: name,
      saveDirectoryPath: normalizedPath || null,
      generationsPath: derivedGenerationsPath,
    });
  },

  setWorkflowName: (name: string) => {
    set({
      workflowName: name,
      hasUnsavedChanges: true,
    });
  },

  setGenerationsPath: (path: string | null) => {
    set({
      generationsPath: path,
    });
  },

  setAutoSaveEnabled: (enabled: boolean) => {
    set({ autoSaveEnabled: enabled });
  },

  setUseExternalImageStorage: (enabled: boolean) => {
    set({ useExternalImageStorage: enabled });
  },

  markAsUnsaved: () => {
    set({ hasUnsavedChanges: true });
  },

  saveToFile: async () => {
    let {
      nodes,
      edges,
      edgeStyle,
      groups,
      projectId,
      workflowId,
      workflowName,
      saveDirectoryPath,
      useExternalImageStorage,
      imageRefBasePath,
    } = get();

    if (!workflowId || !workflowName || (!saveDirectoryPath && !projectId)) {
      return false;
    }

    set({ isSaving: true });

    try {
      // Wait for any pending image/video saves to complete so their IDs are synced
      // This prevents saving workflows with temporary IDs that don't match saved files
      await waitForPendingImageSyncs();

      // Re-fetch nodes after waiting, as imageHistory IDs may have been updated
      let currentNodes = get().nodes;

      // Check if any nodes have existing image refs
      // This helps detect "save to new directory" when imageRefBasePath wasn't set
      // (e.g., workflow loaded from file dialog without directory context)
      const hasExistingRefs = currentNodes.some(node => {
        const data = node.data as Record<string, unknown>;
        return data.imageRef || data.outputImageRef || data.sourceImageRef || data.inputImageRefs;
      });

      const canExternalize = useExternalImageStorage && !!saveDirectoryPath;

      // If saving to a different directory than where refs point, clear refs
      // so images will be re-saved to the new location
      const isNewDirectory = canExternalize && (
        // Case 1: Known different directory
        (imageRefBasePath !== null && imageRefBasePath !== saveDirectoryPath) ||
        // Case 2: Has refs but unknown where they came from - treat as new directory to be safe
        (imageRefBasePath === null && hasExistingRefs)
      );

      if (isNewDirectory) {
        // Generate new workflow ID for the duplicate - prevents localStorage collision
        // This ensures the new project has independent config and preserves the original
        const newWorkflowId = generateWorkflowId();
        workflowId = newWorkflowId;

        // Clear refs so images get saved to new location
        currentNodes = clearNodeImageRefs(currentNodes);
        set({
          nodes: currentNodes,
          workflowId: newWorkflowId,
        });
      }

      let workflow: WorkflowFile = {
        version: 1,
        id: workflowId,
        name: workflowName,
        nodes: currentNodes,
        edges,
        edgeStyle,
        groups: groups && Object.keys(groups).length > 0 ? groups : undefined,
      };

      // If external image storage is enabled, externalize images before saving
      if (canExternalize && saveDirectoryPath) {
        workflow = await externalizeWorkflowImages(workflow, saveDirectoryPath);
      }

      const response = await fetch("/api/workflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          directoryPath: saveDirectoryPath || undefined,
          projectId: projectId || undefined,
          filename: workflowName,
          workflow,
        }),
      });

      const result = await response.json();

      if (result.success) {
        const timestamp = Date.now();
        const resolvedProjectId =
          typeof result.projectId === "string" && result.projectId.trim().length > 0
            ? result.projectId
            : projectId;
        const resolvedWorkflowId =
          typeof result.workflowId === "string" && result.workflowId.trim().length > 0
            ? result.workflowId
            : workflowId;
        const resolvedGenerationsPath =
          typeof result.generationsPath === "string" && result.generationsPath.trim().length > 0
            ? result.generationsPath
            : get().generationsPath ||
              (resolvedProjectId
                ? getProjectGenerationsPublicPath(resolvedProjectId)
                : saveDirectoryPath
                ? `${saveDirectoryPath}/generations`
                : null);

        // If we externalized images, update store nodes with the refs
        // This prevents duplicate images on subsequent saves
        if (canExternalize && workflow.nodes !== currentNodes) {
          // Merge refs from externalized nodes into current nodes (keeping image data)
          const nodesWithRefs = currentNodes.map((node, index) => {
            const externalizedNode = workflow.nodes[index];
            if (!externalizedNode || node.id !== externalizedNode.id) {
              return node; // Safety check - nodes should match
            }

            // Copy refs from externalized node while keeping current image data
            // Use type assertion to access ref fields that may exist on various node types
            const mergedData = { ...node.data } as Record<string, unknown>;
            const extData = externalizedNode.data as Record<string, unknown>;

            // Copy ref fields based on node type
            if (extData.imageRef && typeof extData.imageRef === 'string') {
              mergedData.imageRef = extData.imageRef;
            }
            if (extData.sourceImageRef && typeof extData.sourceImageRef === 'string') {
              mergedData.sourceImageRef = extData.sourceImageRef;
            }
            if (extData.outputImageRef && typeof extData.outputImageRef === 'string') {
              mergedData.outputImageRef = extData.outputImageRef;
            }
            if (extData.inputImageRefs && Array.isArray(extData.inputImageRefs)) {
              mergedData.inputImageRefs = extData.inputImageRefs;
            }

            return { ...node, data: mergedData as WorkflowNodeData } as WorkflowNode;
          });

          set({
            nodes: nodesWithRefs,
            projectId: resolvedProjectId || null,
            workflowId: resolvedWorkflowId,
            generationsPath: resolvedGenerationsPath,
            lastSavedAt: timestamp,
            hasUnsavedChanges: false,
            // Update imageRefBasePath to reflect new save location
            imageRefBasePath: saveDirectoryPath,
          });
        } else {
          set({
            projectId: resolvedProjectId || null,
            workflowId: resolvedWorkflowId,
            generationsPath: resolvedGenerationsPath,
            lastSavedAt: timestamp,
            hasUnsavedChanges: false,
            // Update imageRefBasePath to reflect save location
            imageRefBasePath: canExternalize ? saveDirectoryPath : null,
          });
        }

        // Update localStorage
        saveSaveConfig({
          workflowId: resolvedWorkflowId,
          projectId: resolvedProjectId || null,
          name: workflowName,
          directoryPath: saveDirectoryPath || null,
          generationsPath: resolvedGenerationsPath,
          lastSavedAt: timestamp,
          useExternalImageStorage,
        });

        return true;
      } else {
        useToast.getState().show(`Auto-save failed: ${result.error}`, "error");
        return false;
      }
    } catch (error) {
      useToast
        .getState()
        .show(
          `Auto-save failed: ${error instanceof Error ? error.message : "Unknown error"}`,
          "error"
        );
      return false;
    } finally {
      set({ isSaving: false });
    }
  },

  initializeAutoSave: () => {
    if (autoSaveIntervalId) return;

    autoSaveIntervalId = setInterval(async () => {
      const state = get();
      if (
        state.autoSaveEnabled &&
        state.hasUnsavedChanges &&
        state.workflowId &&
        state.workflowName &&
        (state.saveDirectoryPath || state.projectId) &&
        !state.isSaving
      ) {
        await state.saveToFile();
      }
    }, 90 * 1000); // 90 seconds
  },

  cleanupAutoSave: () => {
    if (autoSaveIntervalId) {
      clearInterval(autoSaveIntervalId);
      autoSaveIntervalId = null;
    }
  },

  // Cost tracking actions
  addIncurredCost: (cost: number) => {
    set((state) => ({ incurredCost: state.incurredCost + cost }));
    get().saveIncurredCost();
  },

  resetIncurredCost: () => {
    set({ incurredCost: 0 });
    get().saveIncurredCost();
  },

  loadIncurredCost: (workflowId: string) => {
    const data = loadWorkflowCostData(workflowId);
    set({ incurredCost: data?.incurredCost || 0 });
  },

  saveIncurredCost: () => {
    const { workflowId, incurredCost } = get();
    if (!workflowId) return;
    saveWorkflowCostData({
      workflowId,
      incurredCost,
      lastUpdated: Date.now(),
    });
  },

  // Provider settings actions
  updateProviderSettings: (settings: ProviderSettings) => {
    set({ providerSettings: settings });
    saveProviderSettings(settings);
  },

  updateProviderApiKey: (providerId: ProviderType, apiKey: string | null) => {
    const { providerSettings } = get();
    const updated: ProviderSettings = {
      providers: {
        ...providerSettings.providers,
        [providerId]: {
          ...providerSettings.providers[providerId],
          apiKey,
        },
      },
    };
    set({ providerSettings: updated });
    saveProviderSettings(updated);
  },

  toggleProvider: (providerId: ProviderType, enabled: boolean) => {
    const { providerSettings } = get();
    const updated: ProviderSettings = {
      providers: {
        ...providerSettings.providers,
        [providerId]: {
          ...providerSettings.providers[providerId],
          enabled,
        },
      },
    };
    set({ providerSettings: updated });
    saveProviderSettings(updated);
  },

  // Model search dialog actions
  setModelSearchOpen: (open: boolean, provider?: ProviderType | null) => {
    set({
      modelSearchOpen: open,
      modelSearchProvider: provider ?? null,
    });
  },

  trackModelUsage: (model: { provider: ProviderType; modelId: string; displayName: string }) => {
    const current = get().recentModels;
    // Remove existing entry for same modelId if present
    const filtered = current.filter((m) => m.modelId !== model.modelId);
    // Prepend new entry with current timestamp
    const updated: RecentModel[] = [
      {
        provider: model.provider,
        modelId: model.modelId,
        displayName: model.displayName,
        timestamp: Date.now(),
      },
      ...filtered,
    ].slice(0, MAX_RECENT_MODELS);
    // Save to localStorage and update state
    saveRecentModels(updated);
    set({ recentModels: updated });
  },

  // Comment navigation actions
  getNodesWithComments: () => {
    const { nodes } = get();
    // Filter nodes that have comments
    const nodesWithComments = nodes.filter((node) => {
      const data = node.data as { comment?: string };
      return data.comment && data.comment.trim().length > 0;
    });

    // Sort by position: top-to-bottom (Y), then left-to-right (X)
    // Use 50px threshold for row grouping
    const ROW_THRESHOLD = 50;
    return nodesWithComments.sort((a, b) => {
      // Check if nodes are in the same "row" (within threshold)
      const yDiff = a.position.y - b.position.y;
      if (Math.abs(yDiff) <= ROW_THRESHOLD) {
        // Same row, sort by X position
        return a.position.x - b.position.x;
      }
      // Different rows, sort by Y position
      return yDiff;
    });
  },

  getUnviewedCommentCount: () => {
    const { viewedCommentNodeIds } = get();
    const nodesWithComments = get().getNodesWithComments();
    return nodesWithComments.filter((node) => !viewedCommentNodeIds.has(node.id)).length;
  },

  markCommentViewed: (nodeId: string) => {
    set((state) => {
      const newViewedSet = new Set(state.viewedCommentNodeIds);
      newViewedSet.add(nodeId);
      return { viewedCommentNodeIds: newViewedSet };
    });
  },

  setNavigationTarget: (nodeId: string | null) => {
    if (nodeId === null) {
      set({ navigationTarget: null });
    } else {
      // Use timestamp to ensure each navigation triggers a new effect even if same node
      set({ navigationTarget: { nodeId, timestamp: Date.now() } });
      // Also focus the comment tooltip on the target node
      set({ focusedCommentNodeId: nodeId });
    }
  },

  setFocusedCommentNodeId: (nodeId: string | null) => {
    set({ focusedCommentNodeId: nodeId });
  },

  resetViewedComments: () => {
    set({ viewedCommentNodeIds: new Set<string>() });
  },

  // AI change snapshot actions
  captureSnapshot: () => {
    const state = get();
    // Deep copy the current workflow state to avoid reference sharing
    const snapshot = {
      nodes: JSON.parse(JSON.stringify(state.nodes)),
      edges: JSON.parse(JSON.stringify(state.edges)),
      groups: JSON.parse(JSON.stringify(state.groups)),
      edgeStyle: state.edgeStyle,
    };
    set({
      previousWorkflowSnapshot: snapshot,
      manualChangeCount: 0,
    });
  },

  revertToSnapshot: () => {
    const state = get();
    if (state.previousWorkflowSnapshot) {
      set({
        nodes: state.previousWorkflowSnapshot.nodes,
        edges: state.previousWorkflowSnapshot.edges,
        groups: state.previousWorkflowSnapshot.groups,
        edgeStyle: state.previousWorkflowSnapshot.edgeStyle,
        previousWorkflowSnapshot: null,
        manualChangeCount: 0,
        hasUnsavedChanges: true,
      });
    }
  },

  clearSnapshot: () => {
    set({
      previousWorkflowSnapshot: null,
      manualChangeCount: 0,
    });
  },

  incrementManualChangeCount: () => {
    const state = get();
    const newCount = state.manualChangeCount + 1;

    // Automatically clear snapshot after 3 manual changes
    if (newCount >= 3) {
      set({
        previousWorkflowSnapshot: null,
        manualChangeCount: 0,
      });
    } else {
      set({ manualChangeCount: newCount });
    }
  },

  applyEditOperations: (operations) => {
    const state = get();
    const result = executeEditOps(operations, {
      nodes: state.nodes,
      edges: state.edges,
    });

    set({
      nodes: result.nodes,
      edges: result.edges,
      hasUnsavedChanges: true,
    });

    return { applied: result.applied, skipped: result.skipped };
  },
}));

/**
 * Stable hook for provider API keys.
 *
 * Returns individual primitive values for each provider's API key.
 * Uses shallow equality comparison to prevent re-renders when the
 * providerSettings object reference changes but the actual key values
 * don't change.
 *
 * This prevents unnecessary re-fetches of /api/models when multiple
 * node instances subscribe to provider settings.
 */
export function useProviderApiKeys() {
  return useWorkflowStore(
    useShallow((state) => ({
      replicateApiKey: state.providerSettings.providers.replicate?.apiKey ?? null,
      falApiKey: state.providerSettings.providers.fal?.apiKey ?? null,
      kieApiKey: state.providerSettings.providers.kie?.apiKey ?? null,
      wavespeedApiKey: state.providerSettings.providers.wavespeed?.apiKey ?? null,
      // Provider enabled states (for conditional UI)
      replicateEnabled: state.providerSettings.providers.replicate?.enabled ?? false,
      kieEnabled: state.providerSettings.providers.kie?.enabled ?? false,
    }))
  );
}
