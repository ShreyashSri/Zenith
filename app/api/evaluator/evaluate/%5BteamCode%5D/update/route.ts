import { NextRequest, NextResponse } from "next/server";
import { authenticateUser, requireEvaluator, createAuthErrorResponse } from "@/lib/middleware/auth";
import dbConnect from "@/lib/db";
import Evaluator from "@/models/Evaluator";
import Team from "@/models/Team";

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

export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ teamCode: string }> }
) {
    try {
        const { teamCode } = await params;

        const authResult = await authenticateUser(request);
        if (!authResult.success) {
            return createAuthErrorResponse(authResult);
        }

        const evaluatorCheck = requireEvaluator(authResult);
        if (evaluatorCheck) {
            return createAuthErrorResponse(evaluatorCheck);
        }

        const body = await request.json();
        const { scores, comments } = body;

        if (!scores || !comments) {
            return createErrorResponse("Missing required fields", "VALIDATION_ERROR", 400);
        }

        const { tech, ux, presentation } = scores;
        if (
            typeof tech !== 'number' || tech < 0 || tech > 100 ||
            typeof ux !== 'number' || ux < 0 || ux > 100 ||
            typeof presentation !== 'number' || presentation < 0 || presentation > 100
        ) {
            return createErrorResponse("Invalid scores. Must be between 0 and 100", "VALIDATION_ERROR", 400);
        }

        await dbConnect();

        const team = await Team.findOne({ teamCode });
        if (!team) {
            return createErrorResponse("Team not found", "TEAM_NOT_FOUND", 404);
        }

        // Check if team is evaluated by THIS evaluator
        if (!team.isEvaluated) {
            return createErrorResponse("Team has not been evaluated yet", "NOT_EVALUATED", 400);
        }

        if (team.evaluator !== authResult.user.uid) {
            return createErrorResponse("You are not the original evaluator of this team", "FORBIDDEN", 403);
        }

        // Update Evaluation
        const previousTotal = team.scores?.total || 0;
        const newTotal = tech + ux + presentation;

        team.scores = { tech, ux, presentation, total: newTotal };
        team.comments = comments;

        await team.save();

        const evaluator = await Evaluator.findOne({ uid: authResult.user.uid });
        if (evaluator) {
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
        }

        return createSuccessResponse("Evaluation updated successfully", {
            teamCode: team.teamCode,
            scores: { ...scores, total: newTotal },
            previousTotal,
            updatedAt: new Date(),
        });

    } catch (error: any) {
        console.error("Update evaluation error:", error);
        return createErrorResponse("Failed to update evaluation", "SERVER_ERROR", 500);
    }
}
