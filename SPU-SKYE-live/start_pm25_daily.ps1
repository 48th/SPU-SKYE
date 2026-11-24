$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

$node = 'C:\Program Files\WindowsApps\OpenAI.CodexPrimaryRuntime.v26-1112-737-0_26.1112.737.0_x64__3k8sg7r9htsxt\dependencies\node'
$env:PM25_NODE = Join-Path $node 'bin\node.exe'
$env:NODE_PATH = Join-Path $node 'node_modules'
& $env:PM25_NODE -e "require('playwright-core')"
if ($LASTEXITCODE -ne 0) { throw 'Unable to load playwright-core' }

$env:PM25_AIR4THAI_DAILY = '1'
$env:PM25_AQMTHAI_DAILY = '1'
$env:PM25_STATION_MODEL_PATH = 'C:\Users\trois_z\Documents\Codex\2026-11-18\referenced-chatgpt-conversation-this-is-an-2\outputs\models\station_extra_trees_bangkok_59.joblib'
& '..\Backend2\.venv\Scripts\python.exe' -m uvicorn main:app --host 127.0.0.1 --port 8001
