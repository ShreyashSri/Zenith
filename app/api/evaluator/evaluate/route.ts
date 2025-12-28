import { NextRequest, NextResponse } from "next/server";
import { authenticateUser, requireEvaluator, createAuthErrorResponse } from "@/lib/middleware/auth";
import dbConnect from "@/lib/db";
import Team from "@/models/Team";
import Evaluator from "@/models/Evaluator";

export const dynamic = 'force-dynamic';

function createSuccessResponse(message: string, data: any, status = 200) {
  return NextResponse.json({
    success: true,
    message,
    data,
  }, { status });
}

function createErrorResponse(message: string, code: string, status: number) {
  return NextResponse.json({
    success: false,
    error: { code, message },
  }, { status });
}

/**
 * PUT /api/evaluator/evaluate
 * Submit evaluation scores for a team
 */
export async function PUT(request: NextRequest) {
  try {
    const authResult = await authenticateUser(request);
    if (!authResult.success) {
      return createAuthErrorResponse(authResult);
    }

    const evaluatorCheck = requireEvaluator(authResult);
    if (evaluatorCheck) {
      return createAuthErrorResponse(evaluatorCheck);
    }

    const body = await request.json();
    const { teamCode, scores, comments } = body;

    if (!teamCode || !scores || !comments) {
      return createErrorResponse("Missing required fields", "VALIDATION_ERROR", 400);
    }

    // Validate scores
    const { tech, ux, presentation } = scores;
    if (
      typeof tech !== 'number' || tech < 0 || tech > 100 ||
      typeof ux !== 'number' || ux < 0 || ux > 100 ||
      typeof presentation !== 'number' || presentation < 0 || presentation > 100
    ) {
      return createErrorResponse("Invalid scores. Must be between 0 and 100", "VALIDATION_ERROR", 400);
    }

    if (comments.length < 10) {
    }

    await dbConnect();

    // Verify evaluator is assigned to this team
    const evaluator = await Evaluator.findOne({ uid: authResult.user.uid });
    if (!evaluator) {
      return createErrorResponse("Evaluator not found", "EVALUATOR_NOT_FOUND", 404);
    }

    const assignedTeamIndex = evaluator.assignedTeams.findIndex(
      (t: any) => t.teamCode === teamCode
    );

    if (assignedTeamIndex === -1) {
      return createErrorResponse("This team is not assigned to you", "TEAM_NOT_ASSIGNED", 403);
    }

    const team = await Team.findOne({ teamCode });
    if (!team) {
      return createErrorResponse("Team not found", "TEAM_NOT_FOUND", 404);
    }

    if (team.isEvaluated) {
      return createErrorResponse("This team has already been evaluated", "ALREADY_EVALUATED", 409);
    }

    // Calculate total score
    const totalScore = tech + ux + presentation;

    team.isEvaluated = true;
    team.scores = { tech, ux, presentation, total: totalScore };
    team.comments = comments;
    team.evaluator = evaluator.uid; // Store evaluator UID
    team.evaluatedAt = new Date();
    await team.save();

    evaluator.assignedTeams[assignedTeamIndex].isEvaluated = true;

    evaluator.lastEvaluationAt = new Date();

    const evaluatedTeamCodes = evaluator.assignedTeams
      .filter((t: any) => t.isEvaluated)
      .map((t: any) => t.teamCode);

    const allEvaluatedTeams = await Team.find({
      teamCode: { $in: evaluatedTeamCodes },
      isEvaluated: true
    }).select('scores.total');

    const totalScoreSum = allEvaluatedTeams.reduce((sum, t) => sum + (t.scores?.total || 0), 0);
    const newAverage = allEvaluatedTeams.length > 0 ? totalScoreSum / allEvaluatedTeams.length : 0;

    if (!evaluator.stats) {
      evaluator.stats = {
        averageScore: 0,
        evaluationsCompleted: 0,
        evaluationsPending: 0
      };
    }
    evaluator.stats.averageScore = parseFloat(newAverage.toFixed(2));

    await evaluator.save();

    return createSuccessResponse("Evaluation submitted successfully", {
      teamCode: team.teamCode,
      teamName: team.teamName,
      scores: { ...scores, total: totalScore },
      comments: team.comments,
      isEvaluated: true,
      evaluatedAt: team.evaluatedAt,
      evaluatedBy: {
        id: evaluator.uid,
        name: evaluator.name
      }
    });
  } catch (error: any) {
    console.error("Submit evaluation error:", error);
    return createErrorResponse("Failed to submit evaluation", "SERVER_ERROR", 500);
  }
}
