# How the Extension Passes Variables to Tests

## Overview
The extension stores variables with each automation and passes them to the test execution environment (GitLab or Local).

## Variable Storage

When you create an automation, variables are stored like this:

```javascript
{
  id: 1234567890,
  name: "Daily HRM Tests",
  executionType: "gitlab", // or "local"
  variables: [
    { key: "USERNAME", encryptedValue: "encrypted_base64_string" },
    { key: "PASSWORD", encryptedValue: "encrypted_base64_string" },
    { key: "DESIRED_PROJECT_NAME", encryptedValue: "encrypted_base64_string" },
    { key: "DESIRED_HOURS", encryptedValue: "encrypted_base64_string" }
  ]
}
```

## How Variables Are Passed

### GitLab Pipeline (Remote)

**Code Location:** `background.js` → `triggerPipeline()`

```javascript
// 1. Decrypt variables
for (const variable of pipeline.variables) {
  const decryptedValue = await decryptValue(variable.encryptedValue);
  formData.append(`variables[${variable.key}]`, decryptedValue);
}

// 2. POST to GitLab API
fetch(pipeline.gitlabUrl, {
  method: "POST",
  body: formData  // Contains: token, ref, variables[USERNAME], variables[PASSWORD], etc.
})
```

**GitLab receives:**
```
POST https://gitlab.com/api/v4/projects/12345/trigger/pipeline
Body:
  token=abc123
  ref=main
  variables[USERNAME]=admin@example.com
  variables[PASSWORD]=secret123
  variables[DESIRED_PROJECT_NAME]=PROJ-0461
  variables[DESIRED_HOURS]=8
```

**GitLab CI (.gitlab-ci.yml) uses them:**
```yaml
script:
  - env | grep -E "^(USERNAME|PASSWORD|DESIRED_PROJECT_NAME|DESIRED_HOURS)" > .env.triggered
  - docker run --env-file .env.triggered ...
```

### Local Execution

**Code Location:** `background.js` → `triggerLocalExecution()`

```javascript
// 1. Decrypt variables
const variables = {};
for (const variable of pipeline.variables) {
  const decryptedValue = await decryptValue(variable.encryptedValue);
  variables[variable.key] = decryptedValue;
}

// 2. POST to local server
fetch('http://localhost:5000/trigger', {
  method: 'POST',
  body: JSON.stringify({ variables })
})
```

**Local server receives:**
```json
{
  "variables": {
    "USERNAME": "admin@example.com",
    "PASSWORD": "secret123",
    "DESIRED_PROJECT_NAME": "PROJ-0461",
    "DESIRED_HOURS": "8"
  }
}
```

**Local server (local_server.py) uses them:**
```python
def run_tests(execution_id, variables):
    # Set environment variables
    env = os.environ.copy()
    env.update(variables)  # USERNAME, PASSWORD, etc. are now in env
    
    # Run robot tests with these env vars
    subprocess.run(
        ['robot', '--outputdir', 'results', 'Tests/Test.robot'],
        env=env  # Robot Framework can access $USERNAME, $PASSWORD, etc.
    )
```

## How Robot Framework Uses Variables

In your `Test.robot` file:

```robot
*** Variables ***
${DESIRED_HOURS}    8
${DESIRED_PROJECT_NAME}    PROJ-0461

*** Test Cases ***
Submit Daily Attendance
    # These variables come from environment:
    # - $USERNAME (from extension)
    # - $PASSWORD (from extension)
    # - $DESIRED_PROJECT_NAME (from extension or default)
    # - $DESIRED_HOURS (from extension or default)
```

The variables from the extension **override** the defaults in the test file.

## Which Test Runs?

**Currently:** The test file is hardcoded:
- **GitLab:** Runs whatever is in the repository (usually `Tests/Test.robot`)
- **Local:** Runs `Tests/Test.robot` (hardcoded in `local_server.py`)

**To make it configurable:**
You could add a "Test File" field to the automation form, then:
- Store it: `testFile: "Tests/Test.robot"`
- Pass it to local server
- Server runs: `robot --outputdir results ${testFile}`

## Summary

**The flow:**
1. User adds variables in extension (USERNAME, PASSWORD, etc.)
2. Extension encrypts and stores them
3. When triggered:
   - **GitLab:** Variables sent as `variables[KEY]=VALUE` in API call
   - **Local:** Variables sent as JSON to local server
4. Test environment receives variables as environment variables
5. Robot Framework accesses them as `$USERNAME`, `$PASSWORD`, etc.

**The test knows what to do because:**
- The test file (`Test.robot`) is already written to use these specific variable names
- The extension just provides the values
- The test logic (login, submit, etc.) is in the Robot Framework file
