const {
    BOOLEAN_FALSE_VALUES,
    BOOLEAN_TRUE_VALUES
} = require('../core/constants.ts');

function ensurePlainObject(value, subject) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${subject} must be a JSON object.`);
    }

    return value;
}

function normalizeNonEmptyString(value, fieldName) {
    if (value === null || value === undefined) {
        throw new Error(`${fieldName} is required.`);
    }

    const normalized = String(value).trim();
    if (!normalized) {
        throw new Error(`${fieldName} must not be empty.`);
    }

    return normalized;
}

function normalizeOptionalString(value) {
    if (value === null || value === undefined) {
        return undefined;
    }

    return String(value).trim();
}

function normalizeEnum(value, allowedValues, fieldName) {
    const normalized = normalizeNonEmptyString(value, fieldName);
    const match = allowedValues.find((candidate) => candidate.toLowerCase() === normalized.toLowerCase());

    if (!match) {
        throw new Error(`${fieldName} must be one of: ${allowedValues.join(', ')}.`);
    }

    return match;
}

function normalizeBooleanLike(value, fieldName) {
    if (typeof value === 'boolean') {
        return value;
    }

    if (typeof value === 'number' && Number.isInteger(value) && (value === 0 || value === 1)) {
        return value === 1;
    }

    const normalized = normalizeNonEmptyString(value, fieldName).toLowerCase();
    if (BOOLEAN_TRUE_VALUES.includes(normalized)) {
        return true;
    }

    if (BOOLEAN_FALSE_VALUES.includes(normalized)) {
        return false;
    }

    throw new Error(`${fieldName} must be boolean-like.`);
}

function normalizeInteger(value, fieldName, options = {}) {
    let normalized;

    if (typeof value === 'number' && Number.isInteger(value)) {
        normalized = value;
    } else {
        const text = normalizeNonEmptyString(value, fieldName);
        if (!/^-?\d+$/.test(text)) {
            throw new Error(`${fieldName} must be an integer.`);
        }

        normalized = Number.parseInt(text, 10);
    }

    if (options.minimum !== undefined && normalized < options.minimum) {
        throw new Error(`${fieldName} must be >= ${options.minimum}.`);
    }

    if (options.maximum !== undefined && normalized > options.maximum) {
        throw new Error(`${fieldName} must be <= ${options.maximum}.`);
    }

    return normalized;
}

function normalizeStringArray(value, fieldName, options = {}) {
    const allowScalar = options.allowScalar === true;
    const unique = options.unique !== false;
    const items = Array.isArray(value) ? value : (allowScalar ? [value] : null);

    if (!items) {
        throw new Error(`${fieldName} must be an array.`);
    }

    const normalized = [];
    for (const item of items) {
        const text = normalizeNonEmptyString(item, fieldName);
        if (!unique || !normalized.includes(text)) {
            normalized.push(text);
        }
    }

    return normalized;
}

function cloneUnknownProperties(input, knownKeys) {
    const extras = {};
    for (const [key, value] of Object.entries(input)) {
        if (!knownKeys.has(key)) {
            extras[key] = value;
        }
    }

    return extras;
}

module.exports = {
    cloneUnknownProperties,
    ensurePlainObject,
    normalizeBooleanLike,
    normalizeEnum,
    normalizeInteger,
    normalizeNonEmptyString,
    normalizeOptionalString,
    normalizeStringArray
};
