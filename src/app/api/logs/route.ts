/**
 * API route for log management
 *
 * Handles:
 * - Saving log sessions to disk
 * - Manual log rotation
 * - Log file cleanup
 */

import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma, isDatabaseConfigured } from '@/lib/prisma';
import { saveSession, rotateLogFiles } from '@/utils/logger-server';
import type { LogSession } from '@/utils/logger';

interface SaveLogsRequestBody {
  session: LogSession;
  projectId?: string | null;
  workflowId?: string | null;
  nodeCount?: number | null;
  cost?: number | null;
  status?: string | null;
  error?: string | null;
}

function deriveRunStatus(session: LogSession): { status: string; error: string | null } {
  const explicitWorkflowError = [...session.entries]
    .reverse()
    .find((entry) => entry.category === 'workflow.error');

  if (explicitWorkflowError) {
    return {
      status: 'error',
      error: explicitWorkflowError.error?.message || explicitWorkflowError.message || null,
    };
  }

  const anyError = [...session.entries].reverse().find((entry) => entry.level === 'error');
  if (anyError) {
    return {
      status: 'error',
      error: anyError.error?.message || anyError.message || null,
    };
  }

  const cancelled = session.entries.some(
    (entry) =>
      entry.category === 'workflow.end' &&
      typeof entry.message === 'string' &&
      entry.message.toLowerCase().includes('cancelled')
  );

  if (cancelled) {
    return { status: 'cancelled', error: null };
  }

  return { status: 'success', error: null };
}

/**
 * POST /api/logs - Save a logging session to disk
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as SaveLogsRequestBody;
    const session = body.session;

    if (!session || !session.sessionId) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid session data',
        },
        { status: 400 }
      );
    }

    // Rotate old log files
    await rotateLogFiles();

    // Save the session
    await saveSession(session);

    if (isDatabaseConfigured()) {
      const derived = deriveRunStatus(session);
      const finalStatus = body.status || derived.status;
      const finalError = body.error || derived.error;
      const sessionJson = session as unknown as Prisma.InputJsonValue;

      const rawProjectId =
        typeof body.projectId === 'string' && body.projectId.trim().length > 0
          ? body.projectId.trim()
          : null;
      const rawWorkflowId =
        typeof body.workflowId === 'string' && body.workflowId.trim().length > 0
          ? body.workflowId.trim()
          : null;

      const project =
        rawProjectId
          ? (await prisma.project.findUnique({ where: { id: rawProjectId } })) ??
            (await prisma.project.create({
              data: { id: rawProjectId, name: 'Untitled Project' },
            }))
          : null;

      const workflow =
        rawWorkflowId
          ? await prisma.workflow.findUnique({ where: { id: rawWorkflowId } })
          : null;

      await prisma.runHistory.upsert({
        where: { sessionId: session.sessionId },
        create: {
          sessionId: session.sessionId,
          projectId: project?.id || null,
          workflowId: workflow?.id || null,
          startedAt: new Date(session.startTime),
          endedAt: session.endTime ? new Date(session.endTime) : null,
          status: finalStatus,
          nodeCount: typeof body.nodeCount === 'number' ? body.nodeCount : null,
          cost: typeof body.cost === 'number' ? body.cost : null,
          error: finalError,
          logs: sessionJson,
        },
        update: {
          projectId: project?.id || null,
          workflowId: workflow?.id || null,
          startedAt: new Date(session.startTime),
          endedAt: session.endTime ? new Date(session.endTime) : null,
          status: finalStatus,
          nodeCount: typeof body.nodeCount === 'number' ? body.nodeCount : null,
          cost: typeof body.cost === 'number' ? body.cost : null,
          error: finalError,
          logs: sessionJson,
        },
      });
    }

    return NextResponse.json({
      success: true,
      sessionId: session.sessionId,
    });
  } catch (error) {
    console.error('Failed to save log session:', error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
