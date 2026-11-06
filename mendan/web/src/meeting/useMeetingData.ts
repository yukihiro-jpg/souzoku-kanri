import { orderBy, where } from "firebase/firestore";
import { P, type CaseDoc, type CheckItem, type DocumentRequirement, type Entity, type Meeting, type ReviewItem, type SuggestedQuestion, type TranscriptSegment } from "@mendan/shared";
import { useCollection, useDoc } from "../lib/hooks";

export type MeetingDoc = Meeting & { aiQuestions?: SuggestedQuestion[]; speakerMap?: Record<string, TranscriptSegment["speaker"]>; usage?: Record<string, number> };

export function useMeetingData(caseId: string, meetingId: string) {
  const caseDoc = useDoc<CaseDoc>(P.case(caseId));
  const meeting = useDoc<MeetingDoc>(P.meeting(caseId, meetingId));
  const segments = useCollection<TranscriptSegment>(P.segments(caseId, meetingId), [orderBy("seq")]);
  const entities = useCollection<Entity>(P.entities(caseId));
  const checkItems = useCollection<CheckItem>(P.checkItems(caseId));
  const documents = useCollection<DocumentRequirement>(P.documents(caseId));
  const reviewItems = useCollection<ReviewItem>(P.reviewItems(caseId), [where("status", "==", "open")]);
  return { caseDoc, meeting, segments, entities, checkItems, documents, reviewItems };
}
