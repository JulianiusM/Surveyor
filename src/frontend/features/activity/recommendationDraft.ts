import type {components} from '../../../types/api/v1';
import type {ActivityManualRecommendation, ActivityRecommendationDraftRow, ActivityRecommendationRow} from '../../../types/FrontendActivityRecommendationTypes';
import type {PilotPlainMessageKey} from '../../../types/FrontendPilotUiTypes';

type Workspace = components['schemas']['ActivityRecommendations'];
type Row = ActivityRecommendationRow;
type Input = components['schemas']['ActivityRecommendationReview']['recommendations'][number];

/** Expected local selection failures retain catalog-owned native feedback. */
export class RecommendationDraftError extends Error {
    constructor(readonly messageKey: PilotPlainMessageKey) { super(messageKey); }
}

/** The same complete serializer feeds preview and apply. Rejected manual rows
 * are canceled intentions; generated rejection rows retain server rejection memory. */
export function recommendationReview(rows: ActivityRecommendationDraftRow[]): components['schemas']['ActivityRecommendationReview'] {
    const recommendations: Input[] = [];
    // Keep provenance and move sources alongside status; reducing this to a
    // participant/slot pair would turn a move or unassignment into an assignment.
    for (const {value} of rows) {
        if (value.manual && value.status === 'REJECTED') continue;
        recommendations.push({...(value.id ? {id: value.id} : {}), itemId: value.item.id, profileId: value.profile.id,
            status: value.status, operation: value.operation, sourceItemId: value.sourceItem?.id ?? null, manual: value.manual});
    }
    return {recommendations};
}

/** Native manual swaps are reciprocal roleless moves. Status/removal always
 * updates both legs; ordinary generated moves retain their independent identity. */
export function recommendationPartners(rows: ActivityRecommendationDraftRow[], row: ActivityRecommendationDraftRow): ActivityRecommendationDraftRow[] {
    if (!row.value.manual || row.value.operation !== 'REASSIGN' || !row.value.sourceItem) return [row];
    // Match the reciprocal source and target, rather than the displayed label.
    const other = rows.find(candidate => candidate !== row && candidate.value.manual && candidate.value.operation === 'REASSIGN'
        && candidate.value.item.id === row.value.sourceItem!.id && candidate.value.sourceItem?.id === row.value.item.id);
    return other ? [row, other] : [row];
}

/** Select actual source assignments in this plan. Named roles cannot be moved
 * by the recommendations workflow and never become modal options. */
export function rolelessRecommendationAssignments(workspace: Workspace, profileId?: string) {
    return workspace.existingAssignments.filter(assignment => (!profileId || assignment.profile.id === profileId)
        && assignment.roles.every(role => role === 'default'));
}

/** Build one manual operation, or both reciprocal swap legs, from the admitted
 * workspace. The server still rechecks eligibility and warnings before persistence. */
export function manualRecommendationRows(workspace: Workspace, rows: ActivityRecommendationDraftRow[], input: ActivityManualRecommendation): Row[] {
    const target = workspace.slots.find(slot => slot.id === input.targetSlotId);
    const participant = workspace.participantOptions.find(person => person.profileId === input.profileId);
    if (!target || !participant) throw new RecommendationDraftError('activity.recommendations.selectParticipant');
    // Match the native duplicate guard before constructing any new draft row.
    if (hasPlacement(target.id, input.profileId)) throw new RecommendationDraftError('activity.recommendations.duplicate');
    const result: Row[] = [makeRow(target, input.profileId, participant.label)];
    if (input.operation === 'ASSIGN') return result;

    const source = rolelessRecommendationAssignments(workspace, input.profileId).find(assignment => assignment.item.id === input.sourceItemId
        && assignment.item.id !== target.id);
    if (!source) throw new RecommendationDraftError('activity.recommendations.selectSource');
    result[0]!.operation = 'REASSIGN';
    result[0]!.sourceItem = source.item;
    if (input.operation === 'REASSIGN') return result;

    // A swap's second leg is constructed before either leg is published. This
    // prevents a rejected second choice from leaving a half-swap in the draft.
    const outgoing = rolelessRecommendationAssignments(workspace).find(assignment => assignment.item.id === target.id
        && assignment.profile.id === input.swapProfileId);
    if (!outgoing || outgoing.profile.id === input.profileId || hasPlacement(source.item.id, outgoing.profile.id))
        throw new RecommendationDraftError('activity.recommendations.selectSwap');
    const second = makeRow(source.item, outgoing.profile.id, outgoing.profile.name);
    second.operation = 'REASSIGN';
    second.sourceItem = target;
    result.push(second);
    return result;

    /** Both proposed and committed placements participate in the native duplicate guard. */
    function hasPlacement(itemId: string, profileId: string): boolean {
        // Labels and operation kinds cannot make a duplicate placement eligible.
        return rows.some(row => row.value.item.id === itemId && row.value.profile?.id === profileId)
            || workspace.existingAssignments.some(assignment => assignment.item.id === itemId && assignment.profile.id === profileId);
    }

    function makeRow(item: Row['item'], id: string, name: string): Row {
        return {item, profile: {id, name}, sourceItem: null, status: 'APPROVED', operation: 'ASSIGN', manual: true};
    }
}

/** Attach warnings only to the identical operation, including its move source.
 * A rejected row does not carry actionable warnings in the native review. */
export function recommendationWarnings(row: Row, warnings: Workspace['warnings']) {
    if (row.status === 'REJECTED') return [];
    return warnings.find(entry => entry.recommendation.itemId === row.item.id && entry.recommendation.profileId === row.profile?.id
        && (entry.recommendation.operation ?? 'ASSIGN') === row.operation
        && (entry.recommendation.sourceItemId ?? null) === (row.sourceItem?.id ?? null))?.warnings ?? [];
}
