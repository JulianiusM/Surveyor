/*
 * Copyright 2026 Julian Malovanij
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import {invoiceText} from './wording';
import type {InvoiceDistributionResult} from '../../types/InvoicePoolTypes';

/** Validate the existing bounded, four-decimal share factor without rounding it. */
export function validateInvoiceFactor(factor: number): number {
    if (!Number.isFinite(factor) || factor < 0 || factor > 1000
        || Math.abs(factor * 10000 - Math.round(factor * 10000)) > 0.000001) {
        throw new Error(invoiceText('factorsMustBeBetweenAndWithAtMostFour'));
    }
    return factor;
}

/** Retain decimal weights exactly instead of introducing errors at whole-cent boundaries. */
function decimalWeight(value: number): {coefficient: bigint; scale: number} {
    // Expand decimal or exponent notation into an integer coefficient and its decimal scale.
    const [significand, exponent = "0"] = value.toString().split("e");
    const [whole, fractional = ""] = significand.split(".");
    const scale = fractional.length - Number(exponent);
    const coefficient = BigInt(whole + fractional);
    return scale < 0
        ? {coefficient: coefficient * 10n ** BigInt(-scale), scale: 0}
        : {coefficient, scale};
}

/** Round every participant's weighted base share in the pool's chosen direction. */
export function distributeInvoiceAmount(
    amount: number,
    participants: {registrationId: number; weight: number; factor: number}[],
    roundUpShares = true,
): Map<number, number> {
    return explainInvoiceDistribution(amount, participants, roundUpShares).amounts;
}

/** Return the exact ratios used for rounding along with their allocations, without a second calculator. */
export function explainInvoiceDistribution(
    amount: number,
    participants: {registrationId: number; weight: number; factor: number}[],
    roundUpShares = true,
): InvoiceDistributionResult {
    // Validate cents and every attendance/factor input before any allocation is produced.
    if (!Number.isFinite(amount)) throw new Error(invoiceText('theSharedAmountMustBeFinite'));
    const cents = Math.round(amount * 100);
    if (!Number.isSafeInteger(cents)) throw new Error(invoiceText('theSharedAmountIsTooLarge'));
    const weighted: {registrationId: number; coefficient: bigint; scale: number}[] = [];
    let scale = 0;
    for (const participant of participants) {
        validateInvoiceFactor(participant.factor);
        if (!Number.isFinite(participant.weight) || participant.weight < 0) {
            throw new Error(invoiceText('attendanceWeightsMustBeNonNegative'));
        }
        const weight = decimalWeight(participant.weight);
        weighted.push({
            registrationId: participant.registrationId,
            coefficient: weight.coefficient * BigInt(Math.round(participant.factor * 10000)),
            scale: weight.scale,
        });
        scale = Math.max(scale, weight.scale);
    }
    // Put all effective weights on one integer scale; the common factor scale cancels in each ratio.
    const integerWeights: {registrationId: number; weight: bigint}[] = [];
    let totalWeight = 0n;
    for (const participant of weighted) {
        const weight = participant.coefficient * 10n ** BigInt(scale - participant.scale);
        integerWeights.push({registrationId: participant.registrationId, weight});
        totalWeight += weight;
    }
    // Zero money may be distributed across zero weights, but a nonzero amount needs a real divisor.
    if (totalWeight === 0n && cents !== 0) {
        throw new Error(invoiceText('noPositiveDistributionWeight'));
    }
    // Round each participant independently before takeovers are combined, preserving equal exact ratios.
    const amounts = new Map<number, number>();
    for (const participant of integerWeights) {
        if (totalWeight === 0n) {
            amounts.set(participant.registrationId, 0);
            continue;
        }
        const numerator = BigInt(cents) * participant.weight;
        let roundedCents = numerator / totalWeight;
        const hasRemainder = numerator % totalWeight !== 0n;
        // BigInt division truncates toward zero, so only one sign needs adjustment per direction.
        if (hasRemainder && roundUpShares && numerator > 0n) roundedCents++;
        if (hasRemainder && !roundUpShares && numerator < 0n) roundedCents--;
        amounts.set(participant.registrationId, Number(roundedCents) / 100);
    }
    // Serialize the exact ratio evidence alongside the amounts; explanations never run a second calculator.
    return {
        amounts,
        totalWeight: totalWeight.toString(),
        weights: new Map(integerWeights.map((participant) => [participant.registrationId, participant.weight.toString()])),
    };
}
