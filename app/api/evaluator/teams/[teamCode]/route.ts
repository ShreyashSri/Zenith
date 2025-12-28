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
 * GET /api/evaluator/teams/:teamCode
 * Get detailed team info for evaluation
 */
export async function GET(
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

    await dbConnect();

    // Verify evaluator is assigned to this team
    const evaluator = await Evaluator.findOne({ uid: authResult.user.uid });
    if (!evaluator) {
      return createErrorResponse("Evaluator profile not found", "EVALUATOR_NOT_FOUND", 404);
    }

    const isAssigned = evaluator.assignedTeams.some(
      (t: any) => t.teamCode === teamCode
    );

    if (!isAssigned) {
      return createErrorResponse("This team is not assigned to you", "TEAM_NOT_ASSIGNED", 403);
    }

    // Fetch Team Details
    const team = await Team.findOne({ teamCode });
    if (!team) {
      return createErrorResponse("Team not found", "TEAM_NOT_FOUND", 404);
    }

    // Fetch Member Details
    const memberUids = team.teamMembers.map(m => m.uid);
    const members = await User.find({ uid: { $in: memberUids } });
    const memberMap = new Map(members.map(u => [u.uid, u]));

    // Fetch Problem Statement Details
    let problemStatement = null;
    if (team.appliedFor) {
      problemStatement = await ProblemStatement.findById(team.appliedFor);
    }

    const formattedMembers = team.teamMembers.map(m => {
      const user = memberMap.get(m.uid);
      if (!user) return null;

      return {
        id: user.uid,
        name: user.name,
        email: user.email,
        phone: user.phone,
        organisation: user.organisation,
        age: user.age,
        bio: user.bio,
        role: m.role,
        resume_link: user.resume_link,
        profile_picture: user.profile_picture,
        leetcode_profile: user.leetcode_profile,
        github_link: user.github_link,
        linkedin_link: user.linkedin_link,
        codeforces_link: user.codeforces_link,
        kaggle_link: user.kaggle_link,
        devfolio_link: user.devfolio_link,
        portfolio_link: user.portfolio_link,
        ctf_profile: user.ctf_profile,
        joinedAt: m.joinedAt
      };
    }).filter(Boolean);

    const activeProblemStatement = problemStatement ? {
      id: problemStatement._id.toString(),
      title: problemStatement.title,
      description: problemStatement.description
    } : null;

    const responseData = {
      teamCode: team.teamCode,
      teamName: team.teamName,
      teamMembers: formattedMembers,
      memberCount: team.memberCount,
      appliedFor: activeProblemStatement,
      videoURL: team.videoURL,
      submissionPDF: team.submissionPDF,
      anyOtherLink: team.anyOtherLink,
      isEvaluated: team.isEvaluated,
      scores: team.scores || null,
      comments: team.comments || null,
      submittedAt: team.submittedAt,
      evaluationCriteria: {
        tech: {
          label: "Technical Implementation",
          maxScore: 100,
          description: "Code quality, architecture, innovation, scalability"
        },
        ux: {
          label: "User Experience",
          maxScore: 100,
          description: "UI design, usability, accessibility, user flow"
        },
        presentation: {
          label: "Presentation Quality",
          maxScore: 100,
          description: "Video pitch clarity, communication, demo quality"
        }
      }
    };

    return createSuccessResponse(responseData);

  } catch (error: any) {
    console.error("Get team for evaluation error:", error);
    return createErrorResponse("Failed to fetch team details", "SERVER_ERROR", 500);
  }
}
