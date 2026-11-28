import type { ActivityEvidence, AutomationAssessment, AutomationScore, BenefitInput, BenefitResult } from '../v03-contracts';
import type { V03EngineApi } from '../v03-contracts';

function checkService({ occurrenceCount, service }: ActivityEvidence): void {
  if (!Number.isSafeInteger(occurrenceCount) || occurrenceCount <= 0 ||
    !Number.isSafeInteger(service.n) || service.n < 0 || service.n > occurrenceCount || service.eligible !== occurrenceCount) {
    throw new RangeError('Activity evidence must have valid occurrence and service counts.');
  }
  const values = [service.meanMin, service.totalMin];
  if (service.n === 0 ? values.some(value => value !== null)
    : values.some(value => value === null || !Number.isFinite(value) || value < 0)) {
    throw new RangeError('Activity evidence must have finite, nonnegative service times when observed.');
  }
}

function checkRating(value: number | null, minimum: number, maximum: number): void {
  if (value !== null && (!Number.isInteger(value) || value < minimum || value > maximum)) {
    throw new RangeError(`Assessment ratings must be integers from ${minimum} to ${maximum}.`);
  }
}

function suitability(assessment: AutomationAssessment): number | null {
  const { ruleBased, digitalReadiness, lowNeedForHumanJudgment } = assessment;
  for (const rating of [ruleBased, digitalReadiness, lowNeedForHumanJudgment]) checkRating(rating, 0, 5);
  return ruleBased === null || digitalReadiness === null || lowNeedForHumanJudgment === null
    ? null : 100 * (ruleBased + digitalReadiness + lowNeedForHumanJudgment) / 15;
}

export const scoreAutomation: V03EngineApi['scoreAutomation'] = (analysis, activity, assessment): AutomationScore => {
  checkRating(assessment.implementationDifficulty, 1, 5);
  if (![null, 'low', 'medium', 'high'].includes(assessment.safetyRisk)) throw new RangeError('Unknown safety risk rating.');
  const suitabilityScore = suitability(assessment);
  let frequencyMax = 0;
  let serviceMax = 0;
  for (const row of analysis.activities) {
    checkService(row);
    frequencyMax = Math.max(frequencyMax, row.occurrenceCount);
    serviceMax = Math.max(serviceMax, row.service.totalMin ?? 0);
  }
  const selected = analysis.activities.find(row => row.activity === activity);
  if (!selected) throw new RangeError('Choose a discovered activity.');
  const measured = selected.service.totalMin;
  const frequency = selected.occurrenceCount / frequencyMax;
  const useService = measured !== null && serviceMax > 0;
  const opportunityScore = 100 * (useService ? (frequency + measured / serviceMax) / 2 : frequency);
  return {
    activity, opportunityScore, suitabilityScore,
    occurrenceDenominator: frequencyMax,
    serviceTotalDenominatorMin: useService ? serviceMax : null,
    opportunityBasis: useService ? 'frequency_and_service' : 'frequency_only',
    score: suitabilityScore === null ? null : (opportunityScore + suitabilityScore) / 2,
    requiresHumanReview: assessment.safetyRisk === null || assessment.safetyRisk === 'high',
  };
};

function checkValue(value: number | null, field: string, min: number, max = Infinity): void {
  if (value !== null && (!Number.isFinite(value) || value < min || value > max)) {
    throw new RangeError(`Invalid ${field}.`);
  }
}

function serviceBenefit(input: Extract<BenefitInput, { kind: 'service_change' }>) {
  const { volume, eligibleShare, currentService, expectedServiceSec, hourlyCost, realizationFraction, currency } = input;
  if (volume !== null && (!Number.isSafeInteger(volume) || volume < 0)) throw new RangeError('Invalid volume.');
  checkValue(eligibleShare, 'eligible share', 0, 1);
  checkValue(realizationFraction, 'realization fraction', 0, 1);
  checkValue(expectedServiceSec, 'expected service seconds', 0);
  checkValue(hourlyCost, 'hourly cost', 0);

  let currentServiceSec = null;
  if (currentService?.source === 'assumed') {
    currentServiceSec = currentService.seconds;
    checkValue(currentServiceSec, 'assumed service seconds', 0);
  } else if (currentService) {
    checkService(currentService.evidence);
    const { meanMin } = currentService.evidence.service;
    currentServiceSec = meanMin === null ? null : meanMin * 60;
  }
  const hoursReleased = volume === null || eligibleShare === null || currentServiceSec === null || expectedServiceSec === null
    ? null : volume * eligibleShare * ((currentServiceSec - expectedServiceSec) / 3600);
  const capacityValue = currency === null || hourlyCost === null || hoursReleased === null ? null : hoursReleased * hourlyCost;
  const monetizedBenefit = capacityValue === null || realizationFraction === null
    ? null : capacityValue * realizationFraction + (input.independentBenefit ?? 0);
  return { currentServiceSec, hoursReleased, capacityValue, monetizedBenefit };
}

export function estimateBenefit(input: BenefitInput): BenefitResult {
  const { periodLabel, currency, costs } = input;
  if (!periodLabel.trim()) throw new RangeError('Choose a period for the benefit and cost estimates.');
  if (currency !== null && !/^[A-Z]{3}$/.test(currency)) throw new RangeError('Use one three-letter uppercase currency code.');
  checkValue(costs.initial, 'initial cost', 0);
  checkValue(costs.recurrent, 'recurrent cost', 0);
  if (input.independentBenefit !== undefined) checkValue(input.independentBenefit, 'independent benefit', -Infinity);

  const labor = input.kind === 'service_change' ? serviceBenefit(input) : {
    currentServiceSec: null, hoursReleased: null, capacityValue: null,
    monetizedBenefit: currency === null ? null : input.independentBenefit,
  };
  const totalCost = currency === null || costs.initial === null || costs.recurrent === null
    ? null : costs.initial + costs.recurrent;
  const netBenefit = labor.monetizedBenefit === null || totalCost === null ? null : labor.monetizedBenefit - totalCost;
  const roiPct = netBenefit === null || !totalCost ? null : netBenefit / totalCost * 100;
  if ([...Object.values(labor), totalCost, netBenefit, roiPct].some(value => value !== null && !Number.isFinite(value))) {
    throw new RangeError('Calculated benefits or costs exceed the numeric range.');
  }
  const roiUnavailable = currency === null ? 'missing_currency' : labor.monetizedBenefit === null ? 'missing_benefit'
    : totalCost === null ? 'missing_cost' : totalCost === 0 ? 'zero_cost' : null;
  return { ...labor, totalCost, netBenefit, roiPct, roiUnavailable };
}
