import type { Candidate, Conditions, Place } from '@/lib/domain/types';
const time = (at: string) => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(at));

export function PlanDifference({ candidate: c, conditions, places, eligible }: { candidate: Candidate; conditions: Conditions; places: Place[]; eligible: boolean }) {
  const delta = c.change.arrivalDeltaMinutes, changed = c.change.placeChanged;
  const name = (id: string) => places.find(p => p.id === id)?.name.replace('한강공원', '') ?? id;
  const headline = changed === false && delta === 0 ? '원래 계획을 유지할 수 있어요.'
    : changed === false && delta !== null ? `장소는 그대로, ${Math.abs(delta)}분 ${delta > 0 ? '늦춰요' : '앞당겨요'}.`
    : changed === true && delta === 0 ? '시간은 그대로, 장소를 바꿔봐요.'
    : changed === true ? '갈 수 있는 다른 한강을 찾았어요.' : '아직 못 정한 산책, 여기서 시작해요.';
  return <div className="plan-difference">
    <p className="difference-caption">{changed === null && delta === null ? '처음 정하는 외출 계획' : '내 계획에서 달라지는 것'}</p>
    <p className="difference-headline" key={`${changed}:${delta}:${c.meetsPreference}`}>{!eligible ? "현재 조건에서는 선택할 수 없어요." : c.meetsPreference ? headline : '지킬 조건은 유지했지만, 혼잡 선호는 확인해요.'}</p>
    <div className="difference-items">
      <span className={changed === true ? 'changed-condition' : 'kept-condition'} key={`place:${c.placeId}`}>
        {changed === false ? '＝ 장소 유지' : changed === true ? `${name(conditions.originalPlan.placeId!)} → ${name(c.placeId)}` : `↗ ${name(c.placeId)}에서`}
      </span>
      <span className={delta !== null && delta !== 0 ? 'changed-condition' : 'kept-condition'} key={`time:${c.arrivalAt}`}>
        {delta === 0 ? '＝ 도착시각 유지' : delta !== null ? `${time(conditions.originalPlan.preferredArrivalAt!)} → ${time(c.arrivalAt)}` : `${time(c.arrivalAt)} 도착`}
      </span>
      {conditions.originalPlan.durationMinutes && <span className="kept-condition">{conditions.originalPlan.durationMinutes}분 머물기</span>}
    </div>
    <p className="decision-reason">{c.visit.preference === 'supported' ? (c.visit.trend === 'same' ? '머무는 시간 전후의 예측 표본이 같은 혼잡 단계이고, 선호 이내예요.' : '머무는 시간 전후의 예측 표본이 모두 혼잡 선호 이내예요.') : c.visit.preference === 'uncertain' ? '전후 예측이 선호 수준을 넘나들어, 계속 선호 이내라고 판단할 수 없어요.' : c.visit.preference === 'exceeds' ? '머무는 시간에 선호보다 붐비는 예측이 포함돼요.' : '머무는 시간의 예측 자료가 충분하지 않아요.'}</p>
  </div>;
}
