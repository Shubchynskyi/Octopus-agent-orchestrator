const { readJsonFile } = require('../core/json.ts');
const { validateManagedConfigByName } = require('../schemas/config-artifacts.ts');
const { validateInitAnswers } = require('../schemas/init-answers.ts');

function loadInitAnswersFile(filePath) {
    return validateInitAnswers(readJsonFile(filePath));
}

function loadManagedConfigFile(configName, filePath) {
    return validateManagedConfigByName(configName, readJsonFile(filePath));
}

module.exports = {
    loadInitAnswersFile,
    loadManagedConfigFile
};
