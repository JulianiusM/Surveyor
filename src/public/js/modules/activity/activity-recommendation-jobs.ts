import {get, post} from "../../core/http";

interface RecommendationJob {
    id: string;
    status: "QUEUED" | "RUNNING" | "COMPLETE" | "FAILED" | "STALE";
    error?: string;
}

const delay = async (milliseconds: number): Promise<void> => await new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
});

export async function generateRecommendationsAndWait(
    planId: string,
    onStatus?: (status: RecommendationJob["status"]) => void,
): Promise<void> {
    const queued = await post(`/api/activity/${planId}/recommendations/auto`, {});
    const jobId = queued?.data?.job?.id as string | undefined;
    if (!jobId) throw new Error("Recommendation job was not accepted");

    for (let attempt = 0; attempt < 1_200; attempt += 1) {
        const response = await get(`/api/activity/${planId}/recommendations/auto/${jobId}`);
        const job = response?.data?.job as RecommendationJob | undefined;
        if (!job) throw new Error("Recommendation job status is unavailable");
        onStatus?.(job.status);
        if (job.status === "COMPLETE") return;
        if (job.status === "FAILED") throw new Error(job.error || "Recommendation generation failed");
        if (job.status === "STALE") throw new Error(job.error || "The plan changed; generate recommendations again");
        await delay(500);
    }

    throw new Error("Recommendation generation timed out");
}
