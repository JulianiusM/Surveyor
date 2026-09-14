/*
 * Copyright 2026 Julian Malovanij
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

export function validateInvoiceFactor(factor: number): number {
    if (!Number.isFinite(factor) || factor < 0 || factor > 1000
        || Math.abs(factor * 10000 - Math.round(factor * 10000)) > 0.000001) {
        throw new Error('Factors must be between 0 and 1000 with at most four decimal places');
    }
    return factor;
}

// Retain decimal weights exactly instead of introducing errors at whole-cent boundaries.
function decimalWeight(value: number): {coefficient: bigint; scale: number} {
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
    if (!Number.isFinite(amount)) throw new Error('The shared amount must be finite');
    const cents = Math.round(amount * 100);
    if (!Number.isSafeInteger(cents)) throw new Error('The shared amount is too large');
    const weighted = participants.map((participant) => {
        validateInvoiceFactor(participant.factor);
        if (!Number.isFinite(participant.weight) || participant.weight < 0) {
            throw new Error('Attendance weights must be non-negative');
        }
        const weight = decimalWeight(participant.weight);
        return {
            registrationId: participant.registrationId,
            coefficient: weight.coefficient * BigInt(Math.round(participant.factor * 10000)),
            scale: weight.scale,
        };
    });
    const scale = weighted.reduce((maximum, participant) => Math.max(maximum, participant.scale), 0);
    const integerWeights = weighted.map((participant) => ({
        registrationId: participant.registrationId,
        weight: participant.coefficient * 10n ** BigInt(scale - participant.scale),
    }));
    const totalWeight = integerWeights.reduce((sum, participant) => sum + participant.weight, 0n);
    if (totalWeight === 0n && cents !== 0) {
        throw new Error('A non-zero shared amount requires at least one participant with a positive factor and distribution weight');
    }
    return new Map(integerWeights.map((participant) => {
        if (totalWeight === 0n) return [participant.registrationId, 0];
        const numerator = BigInt(cents) * participant.weight;
        let roundedCents = numerator / totalWeight;
        const hasRemainder = numerator % totalWeight !== 0n;
        // BigInt division truncates toward zero, so only one sign needs adjustment per direction.
        if (hasRemainder && roundUpShares && numerator > 0n) roundedCents++;
        if (hasRemainder && !roundUpShares && numerator < 0n) roundedCents--;
        return [participant.registrationId, Number(roundedCents) / 100];
    }));
}
