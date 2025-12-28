import { NextRequest, NextResponse } from "next/server";
import { authenticateUser, requireEvaluator, createAuthErrorResponse } from "@/lib/middleware/auth";
import dbConnect from "@/lib/db";
import User from "@/models/User";
import Team from "@/models/Team";
import Evaluator from "@/models/Evaluator";
import ProblemStatement from "@/models/ProblemStatement";

export const dynamic = 'force-dynamic';

function createSuccessResponse(data: any, status = 200) {
  return NextResponse.json({
    success: true,
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
 * GET /api/evaluator/teams
 * Get teams assigned to the evaluator
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await authenticateUser(request);
    if (!authResult.success) {
      return createAuthErrorResponse(authResult);
    }

    const evaluatorCheck = requireEvaluator(authResult);
    if (evaluatorCheck) {
      return createAuthErrorResponse(evaluatorCheck);
    }

    await dbConnect();

    const evaluator = await Evaluator.findOne({ uid: authResult.user.uid });
    if (!evaluator) {
      return createErrorResponse("Evaluator profile not found", "EVALUATOR_NOT_FOUND", 404);
    }

    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const isEvaluatedParam = searchParams.get('isEvaluated');
    const appliedFor = searchParams.get('appliedFor');
    const sortBy = searchParams.get('sortBy') || 'teamName';
    const sortOrder = searchParams.get('sortOrder') === 'desc' ? -1 : 1;

    let assignedTeams = evaluator.assignedTeams || [];

    if (isEvaluatedParam !== null) {
      const isEvaluated = isEvaluatedParam === 'true';
      assignedTeams = assignedTeams.filter((t: any) => t.isEvaluated === isEvaluated);
    }

    const assignedTeamCodes = assignedTeams.map((t: any) => t.teamCode);

    const teamQuery: any = {
      teamCode: { $in: assignedTeamCodes }
    };

    if (appliedFor) {
      teamQuery.appliedFor = appliedFor;
    }

    const totalTeamsCount = await Team.countDocuments(teamQuery);

    const teams = await Team.find(teamQuery)
      .sort({ [sortBy]: sortOrder as any })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('teamMembers.uid');

    const allMemberUids = teams.flatMap(t => t.teamMembers.map(m => m.uid));

    const User = (await import("@/models/User")).default;
    const ProblemStatement = (await import("@/models/ProblemStatement")).default;

    const users = await User.find({ uid: { $in: allMemberUids } }).select('uid name organisation');
    const userMap = new Map(users.map(u => [u.uid, u]));

    const uniquePsIds = new Set(teams.map(t => t.appliedFor).filter((id): id is string => !!id));
    const problemStatements = await ProblemStatement.find({ _id: { $in: Array.from(uniquePsIds) } }).select('_id title');
    const psMap = new Map(problemStatements.map(ps => [ps._id.toString(), ps]));

    const formattedTeams = teams.map(team => {
      const ps = team.appliedFor ? psMap.get(team.appliedFor.toString()) : null;

      const members = team.teamMembers.map(m => {
        const user = userMap.get(m.uid);
        return {
          name: user?.name || 'Unknown',
          organisation: user?.organisation || 'Unknown'
        };
      });

      return {
        teamCode: team.teamCode,
        teamName: team.teamName,
        teamMembers: members,
        memberCount: team.memberCount,
        appliedFor: ps ? {
          id: ps._id.toString(),
          title: ps.title
        } : null,
        isEvaluated: team.isEvaluated,
        videoURL: team.videoURL,
        submissionPDF: team.submissionPDF,
        anyOtherLink: team.anyOtherLink,
        submittedAt: team.submittedAt,
      };
    });

    const stats = {
      totalAssigned: evaluator.assignedCount,
      evaluated: evaluator.evaluatedCount,
      pending: evaluator.assignedCount - evaluator.evaluatedCount
    };

    return createSuccessResponse({
      teams: formattedTeams,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalTeamsCount / limit),
        totalTeams: totalTeamsCount,
        limit
      },
      stats
    });

  } catch (error: any) {
    console.error("Get assigned teams error:", error);
    return createErrorResponse("Failed to fetch assigned teams", "SERVER_ERROR", 500);
  }
}
