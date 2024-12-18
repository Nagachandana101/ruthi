const Interview = require("../models/Interview"); // Import the Interview model
const MAX_ATTEMPTS = process.env.MAX_ATTEMPTS || 5; // Default to 5 if not specified in .env
const Question = require("../models/Question");
const Job = require("../models/Job");
const InterviewService = require("../services/interviewService");
const AzureService = require("../services/azureService");
const OpenAIService = require("../services/openAIService");

// Only for local mongo DB connection for testing
// const Questions = [
//     "What are you looking for in your next job?",
//      "What are your career goals for the next five years?",
//      "Describe a problem that you have solved using data. What did you enjoy about the process?"
// ]

const getQuestions = async (req, res) => {
  // res.json({ Questions }); // Use only for local mongo db connection
  try {
    // Fetch random questions, e.g., 3 questions
    const numberOfQuestions =
      parseInt(process.env.NUMBER_OF_QUESTIONS_IN_INTERVIEW) || 3;
    const randomQuestions = await Question.aggregate([
      { $sample: { size: numberOfQuestions } },
    ]);

    res.json({ Questions: randomQuestions });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error fetching questions" });
  }
};

const getQuestionsBySkills = async (req, res) => {
  try {
    const numberOfQuestions =
      parseInt(process.env.NUMBER_OF_QUESTIONS_IN_INTERVIEW) || 5;

    const jobId = req.body.jobId;

    // Fetch the job by ID
    const job = await Job.findById(jobId);

    // If the job contains pre-existing questions, randomly pick the numberOfQuestions
    if (job.questions && job.questions.length > 0) {
      const shuffledQuestions = job.questions.sort(() => 0.5 - Math.random());
      const selectedQuestions = shuffledQuestions
        .slice(0, numberOfQuestions)
        .map((question) => ({
          _id: question._id,
          type: question.type,
          question: question.question,
        }));

      return res.status(200).json(selectedQuestions);
    }

    // If no questions in the job, fetch based on skills
    const skills = job.skills_required;

    const questions = await Question.aggregate([
      { $match: { skills: { $in: skills } } },
      { $sample: { size: Number(numberOfQuestions) } },
      {
        $project: {
          _id: 1,
          question: 1,
          category: 1,
          type: 1,
        },
      },
    ]);

    res.status(200).json(questions);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error fetching questions" });
  }
};

const saveChunkNumber = async (req, res) => {
  const { userID, jobID, questionID, numberOfChunks } = req.body;
  try {
    // Find the interview based on user_id and job_id
    let interview = await Interview.findOne({ user_id: userID, job_id: jobID });

    if (!interview) {
      // If no interview exists
      return res.status(400).json({ message: "No Interview Exists!" });
    }

    // If interview exists, find the specific question in the data array
    const questionIndex = interview.data.findIndex(
      (item) => item.question.toString() === questionID.toString()
    );

    if (questionIndex > -1) {
      // If question already exists, update the number of chunks
      interview.data[questionIndex].number_of_chunks = numberOfChunks;

      // Save the interview document after updating
      await interview.save();
      return res
        .status(200)
        .json({ message: "Number of chunks saved successfully!" });
    } else {
      // If the question doesn't exist in the interview
      return res
        .status(400)
        .json({ message: "Question doesn't exist in the interview!" });
    }
  } catch (error) {
    console.error("Error saving number of chunks");
    return res.status(500).json({ error: "Error saving number of chunks" });
  }
};

const submitInterview = async (req, res) => {
  const { userId, jobId } = req.body;
  try {
    // Trigger async processes
    // triggerAsyncProcessing(userId, jobId);

    const interview = await Interview.findOne({
      user_id: userId,
      job_id: jobId,
    });
    if (!interview) {
      return res.status(400).json({ message: "No interview found!" });
    }

    interview.isCompleted = true;

    await interview.save();

    res.status(200).json({ message: "Interview submitted successfully" });
  } catch (error) {
    console.error("Error in interview submission:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

const triggerAsyncProcessing = async (userId, jobId) => {
  try {
    console.log(
      `Starting async processing for user ${userId} and job ${jobId}`
    );

    // sleep for 30 seconds
    console.log("Sleeping for 30 seconds...");
    await new Promise((resolve) => setTimeout(resolve, 30000));

    console.log("Processing videos...");
    await AzureService.processVideoForAllQuestions(userId, jobId);

    console.log("Evaluating transcriptions...");
    await OpenAIService.evaluateTranscriptionForAllQuestions(userId, jobId);

    console.log("Async processing completed successfully");
  } catch (error) {
    console.error("Error in async processing:", error);
    // Rethrow the error to be caught by the caller
    throw new Error(`Async processing failed: ${error.message}`);
  }
};

const updateAnswer = async (req, res) => {
  const { user_id, job_id, question_id, transcription } = req.body;
  try {
    await InterviewService.updateAnswer(
      user_id,
      job_id,
      question_id,
      transcription
    );
    res.status(200).json({ message: "Answer updated successfully." });
  } catch (error) {
    console.error("Error updating answer:", error);
    switch (error.message) {
      case "Interview not found":
      case "Question not found":
        res.status(404).json({ message: error.message });
        break;
      case "Answer already exists":
        res
          .status(409)
          .json({ message: "Answer already exists and cannot be updated." });
        break;
      default:
        res
          .status(500)
          .json({ message: "Failed to update answer. Please try again." });
    }
  }
};

const createInterview = async (req, res) => {
  const { user_id, job_id, question_ids } = req.body;

  try {
    await InterviewService.checkExistingInterview(user_id, job_id);

    const data = InterviewService.createInterviewData(question_ids);
    // console.log("data: ", data);
    const interview = await InterviewService.saveInterview(
      user_id,
      job_id,
      data
    );

    res.status(201).json({
      message: "Interview created successfully",
      interview,
    });
  } catch (error) {
    console.error("Error creating interview:", error);
    if (error.message === "Interview already exists for this user and job") {
      res
        .status(400)
        .json({ message: "Interview already exists for this user and job" });
    } else {
      res
        .status(500)
        .json({ message: "Error creating interview", error: error.message });
    }
  }
};

const getCurrentCountOfInterviews = async (req, res) => {
  try {
    const userId = req.user.id;

    // Find the number of interview documents for the user
    let interviewCount = await Interview.countDocuments({ user_id: userId });

    if (interviewCount) {
      return res.status(200).json({ count: interviewCount });
    }
    return res.status(200).json({ count: 0 });
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ message: "Failed to get the count data. Please try again" });
  }
};

const InterviewController = {
  getQuestions,
  getQuestionsBySkills,
  saveChunkNumber,
  submitInterview,
  getCurrentCountOfInterviews,
  createInterview,
  updateAnswer,
};

module.exports = InterviewController;
