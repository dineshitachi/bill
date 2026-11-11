param([int]$Port = 8766, [switch]$CreateAdmin, [switch]$CreateOwner)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($root)) { $root = (Get-Location).Path }
$dataPath = Join-Path $root 'data.json'
$usersPath = Join-Path $root 'users.json'
$databasePath = Join-Path $root 'billing.sqlite3'
$utf8 = [System.Text.UTF8Encoding]::new($false)
$allowedCollections = @('transactions', 'customers', 'items', 'invoices', 'customer-payments', 'business-notifications', 'business-form', 'business-details', 'business-logo')
$staffWritableCollections = @('transactions', 'customers', 'items', 'invoices', 'customer-payments')
$staffCapabilities = @('billing.write', 'customers.write', 'inventory.write')
$loginRateLimits = @{}
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://127.0.0.1:$Port/")

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class BillingSqliteDatabase {
  private const int SQLITE_OK = 0;
  private const int SQLITE_ROW = 100;
  private const int SQLITE_DONE = 101;
  private static IntPtr database;
  private static readonly object gate = new object();
  private static readonly IntPtr SQLITE_TRANSIENT = new IntPtr(-1);
  private const string encryptedPrefix = "dpapi:v1:";

  [StructLayout(LayoutKind.Sequential)]
  private struct DataBlob {
    public int Size;
    public IntPtr Data;
  }

  [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
  private static extern int sqlite3_open16(string filename, out IntPtr db);
  [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
  private static extern int sqlite3_close(IntPtr db);
  [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
  private static extern IntPtr sqlite3_errmsg16(IntPtr db);
  [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl, CharSet = CharSet.Unicode)]
  private static extern int sqlite3_prepare16_v2(IntPtr db, string sql, int bytes, out IntPtr statement, IntPtr tail);
  [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
  private static extern int sqlite3_bind_text16(IntPtr statement, int index, [MarshalAs(UnmanagedType.LPWStr)] string value, int bytes, IntPtr destructor);
  [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
  private static extern int sqlite3_step(IntPtr statement);
  [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
  private static extern int sqlite3_finalize(IntPtr statement);
  [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
  private static extern IntPtr sqlite3_column_text16(IntPtr statement, int column);
  [DllImport("winsqlite3.dll", CallingConvention = CallingConvention.Cdecl)]
  private static extern int sqlite3_busy_timeout(IntPtr db, int milliseconds);
  [DllImport("Crypt32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool CryptProtectData(ref DataBlob input, string description, IntPtr entropy, IntPtr reserved, IntPtr prompt, int flags, out DataBlob output);
  [DllImport("Crypt32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool CryptUnprotectData(ref DataBlob input, IntPtr description, IntPtr entropy, IntPtr reserved, IntPtr prompt, int flags, out DataBlob output);
  [DllImport("Kernel32.dll")]
  private static extern IntPtr LocalFree(IntPtr memory);

  private static void Check(int result) {
    if (result != SQLITE_OK) throw new InvalidOperationException("SQLite error: " + Marshal.PtrToStringUni(sqlite3_errmsg16(database)));
  }

  private static IntPtr Prepare(string sql) {
    IntPtr statement;
    Check(sqlite3_prepare16_v2(database, sql, -1, out statement, IntPtr.Zero));
    return statement;
  }

  private static void Bind(IntPtr statement, string[] values) {
    for (int i = 0; i < values.Length; i++) Check(sqlite3_bind_text16(statement, i + 1, values[i], -1, SQLITE_TRANSIENT));
  }

  private static void Execute(string sql, params string[] values) {
    IntPtr statement = Prepare(sql);
    try {
      Bind(statement, values);
      int result = sqlite3_step(statement);
      if (result != SQLITE_DONE) Check(result);
    } finally { sqlite3_finalize(statement); }
  }

  private static string Column(IntPtr statement, int index) {
    IntPtr value = sqlite3_column_text16(statement, index);
    return value == IntPtr.Zero ? String.Empty : Marshal.PtrToStringUni(value);
  }

  private static string Protect(string value) {
    byte[] plain = Encoding.UTF8.GetBytes(value);
    try { return encryptedPrefix + Convert.ToBase64String(TransformWithDpapi(plain, true)); }
    finally { Array.Clear(plain, 0, plain.Length); }
  }

  private static string Unprotect(string value) {
    if (!value.StartsWith(encryptedPrefix, StringComparison.Ordinal)) return value;
    byte[] encrypted = Convert.FromBase64String(value.Substring(encryptedPrefix.Length));
    byte[] plain = TransformWithDpapi(encrypted, false);
    try { return Encoding.UTF8.GetString(plain); }
    finally {
      Array.Clear(encrypted, 0, encrypted.Length);
      Array.Clear(plain, 0, plain.Length);
    }
  }

  private static byte[] TransformWithDpapi(byte[] input, bool protect) {
    IntPtr inputMemory = Marshal.AllocHGlobal(input.Length);
    DataBlob inputBlob = new DataBlob { Size = input.Length, Data = inputMemory };
    DataBlob outputBlob;
    try {
      Marshal.Copy(input, 0, inputMemory, input.Length);
      bool success = protect
        ? CryptProtectData(ref inputBlob, "Chinnathambi Billing state", IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, 1, out outputBlob)
        : CryptUnprotectData(ref inputBlob, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, 1, out outputBlob);
      if (!success) throw new InvalidOperationException("Windows could not protect or unlock billing data with the current user profile.");
      try {
        byte[] output = new byte[outputBlob.Size];
        Marshal.Copy(outputBlob.Data, output, 0, output.Length);
        return output;
      } finally { LocalFree(outputBlob.Data); }
    } finally { Marshal.FreeHGlobal(inputMemory); }
  }

  private static List<string[]> ReadPlainRows(string sql) {
    var rows = new List<string[]>();
    IntPtr statement = Prepare(sql);
    try {
      int result;
      while ((result = sqlite3_step(statement)) == SQLITE_ROW) rows.Add(new[] { Column(statement, 0), Column(statement, 1) });
      if (result != SQLITE_DONE) Check(result);
    } finally { sqlite3_finalize(statement); }
    return rows;
  }

  private static void ProtectExistingData() {
    var stateRows = ReadPlainRows("SELECT collection, value_json FROM app_state");
    var userRows = ReadPlainRows("SELECT username, record_json FROM app_users");
    Execute("BEGIN IMMEDIATE");
    try {
      foreach (string[] row in stateRows)
        if (!row[1].StartsWith(encryptedPrefix, StringComparison.Ordinal))
          Execute("UPDATE app_state SET value_json = ?1 WHERE collection = ?2", Protect(row[1]), row[0]);
      foreach (string[] row in userRows)
        if (!row[1].StartsWith(encryptedPrefix, StringComparison.Ordinal))
          Execute("UPDATE app_users SET record_json = ?1 WHERE username = ?2", Protect(row[1]), row[0]);
      Execute("COMMIT");
    } catch {
      Execute("ROLLBACK");
      throw;
    }
  }

  public static void Initialize(string path) {
    lock (gate) {
      int result = sqlite3_open16(path, out database);
      if (result != SQLITE_OK) throw new InvalidOperationException("Unable to open SQLite database.");
      Check(sqlite3_busy_timeout(database, 5000));
      Execute("CREATE TABLE IF NOT EXISTS app_state (collection TEXT PRIMARY KEY, value_json TEXT NOT NULL)");
      Execute("CREATE TABLE IF NOT EXISTS app_users (username TEXT PRIMARY KEY COLLATE NOCASE, record_json TEXT NOT NULL)");
      Execute("CREATE TABLE IF NOT EXISTS app_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
      Execute("CREATE TABLE IF NOT EXISTS app_sessions (token_hash TEXT PRIMARY KEY, username TEXT NOT NULL COLLATE NOCASE, expires_utc TEXT NOT NULL)");
      ProtectExistingData();
    }
  }

  public static Dictionary<string, string> ReadState() {
    lock (gate) {
      var values = new Dictionary<string, string>(StringComparer.Ordinal);
      IntPtr statement = Prepare("SELECT collection, value_json FROM app_state");
      try {
        int result;
        while ((result = sqlite3_step(statement)) == SQLITE_ROW) values[Column(statement, 0)] = Unprotect(Column(statement, 1));
        if (result != SQLITE_DONE) Check(result);
      } finally { sqlite3_finalize(statement); }
      return values;
    }
  }

  public static void ReplaceState(string[] collections, string[] values) {
    if (collections.Length != values.Length) throw new ArgumentException("Billing state is incomplete.");
    lock (gate) {
      Execute("BEGIN IMMEDIATE");
      try {
        Execute("DELETE FROM app_state");
        for (int i = 0; i < collections.Length; i++)
          Execute("INSERT INTO app_state(collection, value_json) VALUES(?1, ?2)", collections[i], Protect(values[i]));
        Execute("INSERT OR REPLACE INTO app_metadata(key, value) VALUES('database-modified', 'true')");
        Execute("COMMIT");
      } catch {
        Execute("ROLLBACK");
        throw;
      }
    }
  }

  public static string[] ReadUsers() {
    lock (gate) {
      var users = new List<string>();
      IntPtr statement = Prepare("SELECT record_json FROM app_users ORDER BY rowid");
      try {
        int result;
        while ((result = sqlite3_step(statement)) == SQLITE_ROW) users.Add(Unprotect(Column(statement, 0)));
        if (result != SQLITE_DONE) Check(result);
      } finally { sqlite3_finalize(statement); }
      return users.ToArray();
    }
  }

  public static void ReplaceUsers(string[] usernames, string[] records) {
    if (usernames.Length != records.Length) throw new ArgumentException("User data is incomplete.");
    lock (gate) {
      Execute("BEGIN IMMEDIATE");
      try {
        Execute("DELETE FROM app_users");
        for (int i = 0; i < usernames.Length; i++)
          Execute("INSERT INTO app_users(username, record_json) VALUES(?1, ?2)", usernames[i], Protect(records[i]));
        Execute("INSERT OR REPLACE INTO app_metadata(key, value) VALUES('database-modified', 'true')");
        Execute("COMMIT");
      } catch {
        Execute("ROLLBACK");
        throw;
      }
    }
  }

  public static void SaveSession(string tokenHash, string username, string expiresUtc) {
    lock (gate) Execute("INSERT OR REPLACE INTO app_sessions(token_hash, username, expires_utc) VALUES(?1, ?2, ?3)", tokenHash, username, expiresUtc);
  }

  public static string ReadSession(string tokenHash) {
    lock (gate) {
      IntPtr statement = Prepare("SELECT username || char(10) || expires_utc FROM app_sessions WHERE token_hash = ?1");
      try {
        Bind(statement, new[] { tokenHash });
        int result = sqlite3_step(statement);
        if (result == SQLITE_ROW) return Column(statement, 0);
        if (result == SQLITE_DONE) return String.Empty;
        Check(result);
        return String.Empty;
      } finally { sqlite3_finalize(statement); }
    }
  }

  public static void DeleteSession(string tokenHash) {
    lock (gate) Execute("DELETE FROM app_sessions WHERE token_hash = ?1", tokenHash);
  }

  public static void RevokeUserSessions(string username) {
    lock (gate) Execute("DELETE FROM app_sessions WHERE username = ?1", username);
  }

  public static bool HasMarker(string key) {
    lock (gate) {
      IntPtr statement = Prepare("SELECT value FROM app_metadata WHERE key = ?1");
      try {
        Bind(statement, new[] { key });
        int result = sqlite3_step(statement);
        if (result == SQLITE_ROW) return Column(statement, 0) == "true";
        if (result == SQLITE_DONE) return false;
        Check(result);
        return false;
      } finally { sqlite3_finalize(statement); }
    }
  }

  public static void SetMarker(string key) {
    lock (gate) Execute("INSERT OR REPLACE INTO app_metadata(key, value) VALUES(?1, 'true')", key);
  }

  public static void ClearMarker(string key) {
    lock (gate) Execute("DELETE FROM app_metadata WHERE key = ?1", key);
  }

  public static void Close() {
    lock (gate) {
      if (database != IntPtr.Zero) {
        int result = sqlite3_close(database);
        if (result != SQLITE_OK) throw new InvalidOperationException("Unable to close SQLite database.");
        database = IntPtr.Zero;
      }
    }
  }
}
'@

function Add-SecurityHeaders($Response) {
  $Response.Headers['X-Content-Type-Options'] = 'nosniff'
  $Response.Headers['X-Frame-Options'] = 'DENY'
  $Response.Headers['Referrer-Policy'] = 'no-referrer'
  $Response.Headers['Content-Security-Policy'] = "frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  $Response.Headers['Cache-Control'] = 'no-store'
}

function Write-JsonResponse($Context, [int]$StatusCode, $Value) {
  $bytes = $utf8.GetBytes((ConvertTo-Json -InputObject $Value -Depth 50 -Compress))
  Add-SecurityHeaders $Context.Response
  $Context.Response.StatusCode = $StatusCode
  $Context.Response.ContentType = 'application/json; charset=utf-8'
  $Context.Response.ContentLength64 = $bytes.Length
  $Context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  $Context.Response.Close()
}

function Write-ScreenshotResponse($Context, [string]$ContentType, [byte[]]$Bytes) {
  Add-SecurityHeaders $Context.Response
  $Context.Response.Headers['Content-Security-Policy'] = "default-src 'none'; sandbox"
  $Context.Response.ContentType = $ContentType
  $Context.Response.ContentLength64 = $Bytes.Length
  $Context.Response.OutputStream.Write($Bytes, 0, $Bytes.Length)
  $Context.Response.Close()
}

function ConvertTo-PlainData($Value) {
  if ($null -eq $Value) { return $null }
  if ($Value -is [System.Management.Automation.PSCustomObject]) {
    $plain = @{}
    foreach ($property in $Value.PSObject.Properties) { $plain[$property.Name] = ConvertTo-PlainData $property.Value }
    return $plain
  }
  if ($Value -is [System.Collections.IDictionary]) {
    $plain = @{}
    foreach ($key in $Value.Keys) { $plain[[string]$key] = ConvertTo-PlainData $Value[$key] }
    return $plain
  }
  if ($Value -is [System.Collections.IEnumerable] -and $Value -isnot [string]) {
    $plain = [System.Collections.Generic.List[object]]::new()
    foreach ($item in $Value) { $plain.Add((ConvertTo-PlainData $item)) }
    return ,$plain.ToArray()
  }
  return $Value
}

function Read-JsonBody($Context) {
  $maximumBodyBytes = 1048576
  if ($Context.Request.ContentLength64 -gt $maximumBodyBytes) { throw 'Request is too large.' }
  if ($Context.Request.ContentType -notmatch '^\s*application/json(?:\s*;|$)') { throw 'A JSON request body is required.' }
  $memory = [System.IO.MemoryStream]::new()
  $buffer = New-Object byte[] 8192
  try {
    while (($read = $Context.Request.InputStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
      if ($memory.Length + $read -gt $maximumBodyBytes) { throw 'Request is too large.' }
      $memory.Write($buffer, 0, $read)
    }
    $encoding = [System.Text.UTF8Encoding]::new($false, $true)
    $json = $encoding.GetString($memory.ToArray())
  } finally { $memory.Dispose() }
  try {
    $value = ConvertFrom-Json -InputObject $json
    if ($json.TrimStart().StartsWith('[')) {
      if ($json.Trim() -match '^\[\s*\]$') { return ,([object[]]@()) }
      return ,(ConvertTo-PlainData $value)
    }
    return ConvertTo-PlainData $value
  } catch { throw 'Invalid JSON request body.' }
}

function Read-State {
  $state = @{}
  foreach ($entry in [BillingSqliteDatabase]::ReadState().GetEnumerator()) {
    $value = ConvertTo-PlainData (ConvertFrom-Json -InputObject $entry.Value)
    if ($value -is [System.Collections.IDictionary] -and $value.Contains('value') -and $value.Contains('Count') -and $value['value'] -is [array] -and [int]$value['Count'] -eq $value['value'].Length) {
      $value = $value['value']
    }
    $state[$entry.Key] = $value
  }
  return $state
}

function Write-State($State) {
  $previousState = Read-State
  $changeableKeys = @($State.Keys | Where-Object { $_ -notin @('security-audit', 'change-events', 'change-version') })
  $changeableKeys += @($previousState.Keys | Where-Object { $_ -notin @('security-audit', 'change-events', 'change-version') -and $_ -notin $changeableKeys })
  $changes = [System.Collections.Generic.List[object]]::new()
  foreach ($collection in $changeableKeys) {
    $beforeExists = $previousState.ContainsKey($collection)
    $afterExists = $State.ContainsKey($collection)
    $beforeJson = if ($beforeExists) { ConvertTo-Json -InputObject $previousState[$collection] -Depth 50 -Compress } else { '' }
    $afterJson = if ($afterExists) { ConvertTo-Json -InputObject $State[$collection] -Depth 50 -Compress } else { '' }
    if ($beforeJson -ceq $afterJson) { continue }
    $beforeCount = if ($beforeExists) { @($previousState[$collection]).Count } else { 0 }
    $afterCount = if ($afterExists) { @($State[$collection]).Count } else { 0 }
    $action = if (-not $beforeExists) { 'created' } elseif (-not $afterExists) { 'deleted' } elseif ($afterCount -gt $beforeCount) { 'records_added' } elseif ($afterCount -lt $beforeCount) { 'records_removed' } else { 'updated' }
    $changes.Add(@{ collection = [string]$collection; action = $action; recordCount = [Math]::Max($beforeCount, $afterCount) })
  }
  if ($changes.Count -gt 0) {
    $events = if ($State.ContainsKey('change-events')) { @($State['change-events']) } else { @() }
    $sequence = if ($State.ContainsKey('change-version')) { [long]$State['change-version'] } else { 0L }
    $actor = 'system'
    $actorRole = 'system'
    if ($null -ne $currentUser) { $actor = [string]$currentUser.Username; $actorRole = [string]$currentUser.Role }
    $timestamp = [DateTime]::UtcNow.ToString('o', [Globalization.CultureInfo]::InvariantCulture)
    foreach ($change in $changes) {
      $sequence++
      $events += @{ sequence = $sequence; id = [guid]::NewGuid().ToString(); at = $timestamp; actor = $actor; actorRole = $actorRole; collection = $change.collection; action = $change.action; recordCount = $change.recordCount }
    }
    $State['change-version'] = $sequence
    $State['change-events'] = @($events | Select-Object -Last 1000)
  }
  $collections = [System.Collections.Generic.List[string]]::new()
  $values = [System.Collections.Generic.List[string]]::new()
  foreach ($collection in $State.Keys) {
    $collections.Add([string]$collection)
    $values.Add((ConvertTo-Json -InputObject $State[$collection] -Depth 50 -Compress))
  }
  [BillingSqliteDatabase]::ReplaceState($collections.ToArray(), $values.ToArray())
}

function Read-LegacyState {
  $state = @{}
  if (Test-Path -LiteralPath $dataPath) {
    $saved = Get-Content -LiteralPath $dataPath -Raw | ConvertFrom-Json
    if ($null -ne $saved) { foreach ($property in $saved.PSObject.Properties) { $state[$property.Name] = $property.Value } }
  }
  return $state
}

function Read-LegacyUsers {
  if (-not (Test-Path -LiteralPath $usersPath)) { return @() }
  $savedUsers = Get-Content -LiteralPath $usersPath -Raw | ConvertFrom-Json
  $users = [System.Collections.Generic.List[object]]::new()
  foreach ($entry in @($savedUsers)) {
    if ($null -eq $entry) { continue }
    if ($entry.PSObject.Properties['Username']) { $users.Add($entry); continue }
    if ($entry.PSObject.Properties['value']) {
      foreach ($user in @($entry.value)) {
        if ($null -ne $user -and $user.PSObject.Properties['Username']) { $users.Add($user) }
      }
    }
  }
  return @($users.ToArray())
}

function Read-Users {
  $users = [System.Collections.Generic.List[object]]::new()
  foreach ($record in [BillingSqliteDatabase]::ReadUsers()) {
    $user = ConvertFrom-Json -InputObject $record
    if ($null -ne $user -and $user.PSObject.Properties['Username']) { $users.Add($user) }
  }
  return @($users.ToArray())
}

function Write-Users($Users) {
  $usernames = @($Users | ForEach-Object { [string]$_.Username })
  $records = @($Users | ForEach-Object { ConvertTo-Json -InputObject $_ -Depth 10 -Compress })
  [BillingSqliteDatabase]::ReplaceUsers([string[]]$usernames, [string[]]$records)
}

function ConvertTo-SaleAmount([decimal]$Value) {
  return [Math]::Round($Value, 2, [MidpointRounding]::AwayFromZero)
}

function Get-NextInvoiceNumber($Invoices, [string]$Year) {
  $highest = 0
  foreach ($savedInvoice in $Invoices) {
    if ([string]$savedInvoice.number -match ('^INV-' + [regex]::Escape($Year) + '-(\d+)$')) {
      $sequence = [int]$Matches[1]
      if ($sequence -gt $highest) { $highest = $sequence }
    }
  }
  return 'INV-' + $Year + '-' + ($highest + 1).ToString('D4')
}

function Get-StateRecordKey([string]$Collection, $Record) {
  if (-not [string]::IsNullOrWhiteSpace([string]$Record.id)) { return 'id:' + [string]$Record.id }
  if (-not [string]::IsNullOrWhiteSpace([string]$Record.operationId)) { return 'operation:' + [string]$Record.operationId }
  if ($Collection -eq 'transactions' -and -not [string]::IsNullOrWhiteSpace([string]$Record.number)) {
    return 'transaction:' + [string]$Record.date + ':' + [string]$Record.type + ':' + [string]$Record.number + ':' + [string]$Record.party
  }
  return $null
}

[BillingSqliteDatabase]::Initialize($databasePath)
if (-not [BillingSqliteDatabase]::HasMarker('legacy-json-imported')) {
  $databaseState = [BillingSqliteDatabase]::ReadState()
  if ($databaseState.Count -eq 0) {
    $legacyState = Read-LegacyState
    if ($legacyState.Count -gt 0) { Write-State $legacyState }
  }
  if (@([BillingSqliteDatabase]::ReadUsers()).Count -eq 0) {
    $legacyUsers = @(Read-LegacyUsers)
    if ($legacyUsers.Count -gt 0) { Write-Users -Users $legacyUsers }
  }
  [BillingSqliteDatabase]::SetMarker('legacy-json-imported')
  [BillingSqliteDatabase]::ClearMarker('database-modified')
} elseif (-not [BillingSqliteDatabase]::HasMarker('database-modified')) {
  $legacyState = Read-LegacyState
  if ($legacyState.Count -gt 0) { Write-State $legacyState }
  $legacyUsers = @(Read-LegacyUsers)
  if ($legacyUsers.Count -gt 0) { Write-Users -Users $legacyUsers }
  [BillingSqliteDatabase]::ClearMarker('database-modified')
}

function ConvertTo-PasswordBytes([System.Security.SecureString]$Value) {
  $pointer = [System.Runtime.InteropServices.Marshal]::SecureStringToGlobalAllocUnicode($Value)
  $characters = New-Object char[] $Value.Length
  try {
    for ($index = 0; $index -lt $Value.Length; $index++) {
      $characters[$index] = [char]([System.Runtime.InteropServices.Marshal]::ReadInt16($pointer, $index * 2) -band 0xFFFF)
    }
    return ,([System.Text.Encoding]::UTF8.GetBytes($characters))
  } finally {
    [Array]::Clear($characters, 0, $characters.Length)
    [System.Runtime.InteropServices.Marshal]::ZeroFreeGlobalAllocUnicode($pointer)
  }
}

function New-PasswordRecord([System.Security.SecureString]$Password) {
  $salt = New-Object byte[] 16
  $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $random.GetBytes($salt) } finally { $random.Dispose() }
  $passwordBytes = ConvertTo-PasswordBytes $Password
  $derive = $null
  try {
    $derive = [System.Security.Cryptography.Rfc2898DeriveBytes]::new($passwordBytes, $salt, 150000)
    $hash = $derive.GetBytes(32)
  }
  finally {
    if ($null -ne $derive) { $derive.Dispose() }
    [Array]::Clear($passwordBytes, 0, $passwordBytes.Length)
  }
  return @{ Salt = [Convert]::ToBase64String($salt); Hash = [Convert]::ToBase64String($hash) }
}

function Test-Password([System.Security.SecureString]$Password, $User) {
  $salt = [Convert]::FromBase64String($User.Salt)
  $expected = [Convert]::FromBase64String($User.Hash)
  $passwordBytes = ConvertTo-PasswordBytes $Password
  $derive = $null
  $actual = $null
  try {
    $derive = [System.Security.Cryptography.Rfc2898DeriveBytes]::new($passwordBytes, $salt, 150000)
    $actual = $derive.GetBytes(32)
    $difference = 0
    for ($index = 0; $index -lt $expected.Length; $index++) { $difference = $difference -bor ($expected[$index] -bxor $actual[$index]) }
    return $difference -eq 0
  } finally {
    if ($null -ne $derive) { $derive.Dispose() }
    [Array]::Clear($passwordBytes, 0, $passwordBytes.Length)
    if ($null -ne $actual) { [Array]::Clear($actual, 0, $actual.Length) }
  }
}

function New-User([string]$Username, [string]$DisplayName, [System.Security.SecureString]$Password, [string]$Role, [string]$Email = '', [string]$RoleDefinitionId = '') {
  $passwordRecord = New-PasswordRecord $Password
  return [pscustomobject]@{
    Id = [Guid]::NewGuid().ToString('N')
    Username = $Username
    Email = $Email
    DisplayName = $DisplayName
    Role = $Role
    RoleDefinitionId = $RoleDefinitionId
    Salt = $passwordRecord.Salt
    Hash = $passwordRecord.Hash
  }
}

function Test-SecureStringEqual([System.Security.SecureString]$First, [System.Security.SecureString]$Second) {
  if ($First.Length -ne $Second.Length) { return $false }
  $firstPointer = [System.Runtime.InteropServices.Marshal]::SecureStringToGlobalAllocUnicode($First)
  $secondPointer = [System.Runtime.InteropServices.Marshal]::SecureStringToGlobalAllocUnicode($Second)
  try {
    $difference = 0
    for ($index = 0; $index -lt $First.Length; $index++) {
      $difference = $difference -bor ([System.Runtime.InteropServices.Marshal]::ReadInt16($firstPointer, $index * 2) -bxor [System.Runtime.InteropServices.Marshal]::ReadInt16($secondPointer, $index * 2))
    }
    return $difference -eq 0
  } finally {
    [System.Runtime.InteropServices.Marshal]::ZeroFreeGlobalAllocUnicode($firstPointer)
    [System.Runtime.InteropServices.Marshal]::ZeroFreeGlobalAllocUnicode($secondPointer)
  }
}

function Test-AdminControl($User) {
  return $null -ne $User -and $User.Role -in @('admin', 'owner')
}

function Test-StaffCapability($User, [string]$Capability) {
  if ($null -eq $User -or $User.Role -ne 'staff' -or [string]::IsNullOrWhiteSpace([string]$User.RoleDefinitionId)) { return $true }
  if ($Capability -notin $staffCapabilities) { return $false }
  $state = Read-State
  $definitions = if ($state.ContainsKey('role-definitions')) { @($state['role-definitions']) } else { @() }
  $definition = $definitions | Where-Object { $_.id -eq $User.RoleDefinitionId -and $_.tier -eq 'staff' } | Select-Object -First 1
  return $null -ne $definition -and @($definition.capabilities) -contains $Capability
}
function Get-StaffCapabilityForCollection([string]$Collection) {
  switch ($Collection) {
    { $_ -in @('transactions', 'invoices', 'customer-payments') } { return 'billing.write' }
    'customers' { return 'customers.write' }
    'items' { return 'inventory.write' }
    default { return '' }
  }
}

function Add-SecurityAuditEvent([string]$Actor, [string]$Action, [string]$Target, [string]$ActorRole = 'system') {
  $state = Read-State
  $entries = if ($state.ContainsKey('security-audit')) { @($state['security-audit']) } else { @() }
  $sequence = if ($state.ContainsKey('change-version')) { [long]$state['change-version'] } else { 0L }
  $auditRecord = @{
    id = [guid]::NewGuid().ToString()
    at = [DateTime]::UtcNow.ToString('o', [Globalization.CultureInfo]::InvariantCulture)
    actor = $Actor
    actorRole = $ActorRole
    action = $Action
    target = $Target
  }
  $state['security-audit'] = @($auditRecord) + @($entries | Select-Object -First 499)
  $sequence++
  $changeEvents = if ($state.ContainsKey('change-events')) { @($state['change-events']) } else { @() }
  $changeEvents += @{ sequence = $sequence; id = $auditRecord.id; at = $auditRecord.at; actor = $Actor; actorRole = $ActorRole; collection = 'security'; action = $Action; recordCount = 0 }
  $state['change-version'] = $sequence
  $state['change-events'] = @($changeEvents | Select-Object -Last 1000)
  Write-State $state
}

if ($CreateAdmin -or $CreateOwner) {
  if ($CreateAdmin -and $CreateOwner) { throw 'Choose either -CreateAdmin or -CreateOwner.' }
  $accountLabel = if ($CreateOwner) { 'Master Control' } else { 'Administrator' }
  $displayName = (Read-Host "$accountLabel display name").Trim()
  $username = (Read-Host "$accountLabel username").Trim().ToLowerInvariant()
  if ($username -notmatch '^[a-z0-9._-]{3,32}$' -or $displayName.Length -lt 2) {
    throw 'Use a 3-32 character username and a display name of at least 2 characters.'
  }
  $users = @(Read-Users)
  if ($CreateOwner -and @($users | Where-Object { $_.Role -eq 'owner' }).Count -gt 0) {
    throw 'A Master Control account already exists.'
  }
  if (@($users | Where-Object { $_.Username -eq $username }).Count -gt 0) {
    throw 'That username already exists.'
  }
  $securePassword = Read-Host "$accountLabel password (6-20 characters)" -AsSecureString
  $secureConfirmation = Read-Host "Confirm $accountLabel password" -AsSecureString
  try {
    if ($securePassword.Length -lt 6 -or $securePassword.Length -gt 20) { throw 'Password must be 6-20 characters.' }
    if (-not (Test-SecureStringEqual $securePassword $secureConfirmation)) { throw 'Passwords do not match.' }
    $role = if ($CreateOwner) { 'owner' } else { 'admin' }
    $administrator = New-User $username $displayName $securePassword $role
    Write-Users -Users ($users + $administrator)
    Add-SecurityAuditEvent 'system' "account.created.$role" $username 'system'
  } finally {
    $securePassword.Dispose()
    $secureConfirmation.Dispose()
  }
  Write-Host "$accountLabel account '$username' created with full access."
  exit 0
}

function Get-SessionTokenHash([string]$Token) {
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try { return [Convert]::ToBase64String($sha256.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($Token))) }
  finally { $sha256.Dispose() }
}

function Get-CurrentUser($Context) {
  $cookie = $Context.Request.Cookies['sid']
  if ($null -eq $cookie -or [string]::IsNullOrWhiteSpace($cookie.Value)) { return $null }
  $tokenHash = Get-SessionTokenHash $cookie.Value
  $record = [BillingSqliteDatabase]::ReadSession($tokenHash)
  if ([string]::IsNullOrWhiteSpace($record)) { return $null }
  $separatorIndex = $record.IndexOf("`n")
  if ($separatorIndex -lt 1) { [BillingSqliteDatabase]::DeleteSession($tokenHash); return $null }
  $username = $record.Substring(0, $separatorIndex)
  $expiresAt = [DateTime]::Parse($record.Substring($separatorIndex + 1), [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind)
  if ($expiresAt -le [DateTime]::UtcNow) {
    [BillingSqliteDatabase]::DeleteSession($tokenHash)
    return $null
  }
  $user = @(Read-Users) | Where-Object { $_.Username -eq $username } | Select-Object -First 1
  if ($null -eq $user -or $user.Disabled -eq $true) { [BillingSqliteDatabase]::DeleteSession($tokenHash); return $null }
  return $user
}

function Set-Session($Context, $User, [int]$LifetimeSeconds = 28800) {
  $tokenBytes = New-Object byte[] 32
  $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $random.GetBytes($tokenBytes) } finally { $random.Dispose() }
  $token = [Convert]::ToBase64String($tokenBytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
  $expiresAt = [DateTime]::UtcNow.AddSeconds($LifetimeSeconds)
  [BillingSqliteDatabase]::SaveSession((Get-SessionTokenHash $token), [string]$User.Username, $expiresAt.ToString('o', [Globalization.CultureInfo]::InvariantCulture))
  $secureAttribute = if ($Context.Request.IsSecureConnection) { '; Secure' } else { '' }
  $Context.Response.Headers.Add('Set-Cookie', "sid=$token; Path=/; HttpOnly; SameSite=Strict; Max-Age=$LifetimeSeconds$secureAttribute")
}

function Clear-Session($Context) {
  $cookie = $Context.Request.Cookies['sid']
  if ($null -ne $cookie -and -not [string]::IsNullOrWhiteSpace($cookie.Value)) { [BillingSqliteDatabase]::DeleteSession((Get-SessionTokenHash $cookie.Value)) }
  $Context.Response.Headers.Add('Set-Cookie', 'sid=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0')
}

function Write-Unauthorized($Context) { Write-JsonResponse $Context 401 @{ error = 'Sign in required.' } }
function Write-Forbidden($Context) { Write-JsonResponse $Context 403 @{ error = 'Admin access required.' } }

function Test-LoginRateLimit($Context) {
  $now = [DateTime]::UtcNow
  foreach ($client in @($loginRateLimits.Keys)) {
    if ($loginRateLimits[$client].ResetAt -le $now) { $loginRateLimits.Remove($client) }
  }
  $client = $Context.Request.RemoteEndPoint.Address.ToString()
  if (-not $loginRateLimits.ContainsKey($client) -or $loginRateLimits[$client].ResetAt -le $now) {
    $loginRateLimits[$client] = @{ Count = 0; ResetAt = $now.AddMinutes(1) }
  }
  $limit = $loginRateLimits[$client]
  if ($limit.Count -ge 20) { return $false }
  $limit.Count++
  return $true
}

$listener.Start()
Write-Host "Billing app backend running at http://127.0.0.1:$Port/bill.html"
Write-Host "Database: $databasePath"
Write-Host 'Press Ctrl+C to stop the server.'

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    try {
      $request = $context.Request
      $path = $request.Url.AbsolutePath

      if ($request.HttpMethod -eq 'GET' -and $path -eq '/health') {
        Write-JsonResponse $context 200 @{ status = 'ok'; storage = 'sqlite'; database = [System.IO.Path]::GetFileName($databasePath) }
        continue
      }

      if ($request.HttpMethod -eq 'GET' -and $path -eq '/api/auth/status') {
        Write-JsonResponse $context 200 @{ needsSetup = @((Read-Users)).Count -eq 0 }
        continue
      }

      if ($request.HttpMethod -eq 'POST' -and $path -eq '/api/auth/setup') {
        $users = @(Read-Users)
        if ($users.Count -gt 0) { Write-JsonResponse $context 409 @{ error = 'Admin setup is already complete.' }; continue }
        $body = Read-JsonBody $context
        $username = ([string]$body.username).Trim().ToLowerInvariant()
        $displayName = ([string]$body.displayName).Trim()
        $plainPassword = [string]$body.password
        if ($username -notmatch '^[a-z0-9._-]{3,32}$' -or $displayName.Length -lt 2 -or $plainPassword.Length -lt 6 -or $plainPassword.Length -gt 20) {
          $body.password = $null
          $plainPassword = $null
          Write-JsonResponse $context 400 @{ error = 'Use a 3-32 character username, a display name, and a password of 6-20 characters.' }
          continue
        }
        $securePassword = ConvertTo-SecureString -String $plainPassword -AsPlainText -Force
        $body.password = $null
        $plainPassword = $null
        try {
          $admin = New-User $username $displayName $securePassword 'admin'
          Write-Users @($admin)
          Set-Session $context $admin
          Write-JsonResponse $context 201 @{ user = @{ username = $admin.Username; email = $admin.Email; displayName = $admin.DisplayName; role = $admin.Role } }
        } finally { $securePassword.Dispose() }
        continue
      }

      if ($request.HttpMethod -eq 'POST' -and $path -eq '/api/auth/register') {
        $body = Read-JsonBody $context
        $displayName = ([string]$body.displayName).Trim()
        $username = ([string]$body.username).Trim().ToLowerInvariant()
        $email = ([string]$body.email).Trim().ToLowerInvariant()
        $plainPassword = [string]$body.password
        $invalidEmail = -not [string]::IsNullOrWhiteSpace($email) -and $email -notmatch '^[^\s@]+@[^\s@]+\.[^\s@]+$'
        if ($displayName.Length -lt 2 -or $displayName.Length -gt 80 -or $username -notmatch '^[a-z0-9._-]{3,32}$' -or $invalidEmail -or $plainPassword.Length -lt 6 -or $plainPassword.Length -gt 20) {
          $body.password = $null
          $plainPassword = $null
          Write-JsonResponse $context 400 @{ error = 'Enter a name, a 3-32 character username, an optional valid email, and a password of 6-20 characters.' }
          continue
        }
        $securePassword = ConvertTo-SecureString -String $plainPassword -AsPlainText -Force
        $body.password = $null
        $plainPassword = $null
        try {
          $users = @(Read-Users)
          if (@($users | Where-Object { $_.Username -eq $username -or ($email -and $_.Email -and $_.Email -eq $email) }).Count -gt 0) {
            Write-JsonResponse $context 409 @{ error = 'That username or email already exists.' }
            continue
          }
          $registeredUser = New-User $username $displayName $securePassword 'staff' $email
          Write-Users -Users ($users + $registeredUser)
          Set-Session $context $registeredUser
          Write-JsonResponse $context 201 @{ user = @{ username = $registeredUser.Username; email = $registeredUser.Email; displayName = $registeredUser.DisplayName; role = $registeredUser.Role } }
        } finally { $securePassword.Dispose() }
        continue
      }

      if ($request.HttpMethod -eq 'POST' -and $path -eq '/api/auth/login') {
        if (-not (Test-LoginRateLimit $context)) {
          $context.Response.Headers.Add('Retry-After', '60')
          Write-JsonResponse $context 429 @{ error = 'Too many sign-in attempts. Try again in a minute.' }
          continue
        }
        $body = Read-JsonBody $context
        $username = ([string]$body.username).Trim().ToLowerInvariant()
        $plainPassword = [string]$body.password
        $body.password = $null
        $securePassword = ConvertTo-SecureString -String $plainPassword -AsPlainText -Force
        $plainPassword = $null
        try {
          $user = @(Read-Users) | Where-Object { $_.Username -eq $username } | Select-Object -First 1
          $validPassword = $null -ne $user -and $user.Disabled -ne $true -and (Test-Password $securePassword $user)
        } finally { $securePassword.Dispose() }
        if (-not $validPassword) { Write-JsonResponse $context 401 @{ error = 'Username or password is incorrect.' }; continue }
        Set-Session $context $user 28800
        if ($user.Role -in @('admin', 'owner')) { Add-SecurityAuditEvent $user.Username "auth.login.$($user.Role)" $user.Username $user.Role }
        Write-JsonResponse $context 200 @{ user = @{ username = $user.Username; email = $user.Email; displayName = $user.DisplayName; role = $user.Role } }
        continue
      }

      if ($request.HttpMethod -eq 'POST' -and $path -eq '/api/auth/logout') {
        Clear-Session $context
        Write-JsonResponse $context 200 @{ signedOut = $true }
        continue
      }

      if ($request.HttpMethod -eq 'GET' -and $path -eq '/api/auth/me') {
        $currentUser = Get-CurrentUser $context
        if ($null -eq $currentUser) { Write-Unauthorized $context; continue }
        Write-JsonResponse $context 200 @{ user = @{ username = $currentUser.Username; email = $currentUser.Email; displayName = $currentUser.DisplayName; role = $currentUser.Role } }
        continue
      }

      $currentUser = Get-CurrentUser $context
      if ((Test-AdminControl $currentUser) -and $request.HttpMethod -in @('POST', 'PUT', 'PATCH', 'DELETE')) {
        Add-SecurityAuditEvent $currentUser.Username 'api.write.attempt' "$($request.HttpMethod) $path" $currentUser.Role
      }
      if ($request.HttpMethod -eq 'GET' -and $path -eq '/api/changes') {
        if ($null -eq $currentUser) { Write-Unauthorized $context; continue }
        $sinceText = [string]$request.QueryString['since']
        $since = 0L
        if ($sinceText -and -not [long]::TryParse($sinceText, [ref]$since)) { Write-JsonResponse $context 400 @{ error = 'Change cursor must be an integer.' }; continue }
        if ($since -lt 0) { Write-JsonResponse $context 400 @{ error = 'Change cursor cannot be negative.' }; continue }
        $state = Read-State
        $version = if ($state.ContainsKey('change-version')) { [long]$state['change-version'] } else { 0L }
        $history = if ($state.ContainsKey('change-events')) { @($state['change-events']) } else { @() }
        $oldest = if ($history.Count) { [long]$history[0].sequence } else { $version + 1 }
        $fullSync = $since -lt ($oldest - 1) -and $since -lt $version
        $visibleEvents = $history | Where-Object {
          [long]$_.sequence -gt $since -and
          ($_.actorRole -eq 'system' -or ($currentUser.Role -eq 'owner' -and $_.actorRole -in @('owner', 'admin', 'staff')) -or ($currentUser.Role -eq 'admin' -and $_.actorRole -in @('owner', 'staff')) -or ($currentUser.Role -eq 'staff' -and $_.actorRole -eq 'owner'))
        } | Select-Object -Last 100
        Write-JsonResponse $context 200 @{ version = $version; fullSync = $fullSync; events = @($visibleEvents) }
        continue
      }
      if ($request.HttpMethod -eq 'GET' -and $path -eq '/api/admin/audit') {
        if ($null -eq $currentUser) { Write-Unauthorized $context; continue }
        if ($currentUser.Role -ne 'owner') { Write-Forbidden $context; continue }
        $state = Read-State
        $events = if ($state.ContainsKey('security-audit')) { @($state['security-audit'] | Select-Object -First 100) } else { @() }
        Write-JsonResponse $context 200 @{ events = $events }
        continue
      }
      if ($request.HttpMethod -eq 'GET' -and $path -eq '/api/roles') {
        if ($null -eq $currentUser) { Write-Unauthorized $context; continue }
        if (-not (Test-AdminControl $currentUser)) { Write-Forbidden $context; continue }
        $state = Read-State
        $definitions = if ($state.ContainsKey('role-definitions')) { @($state['role-definitions']) } else { @() }
        if ($currentUser.Role -eq 'admin') { $definitions = @($definitions | Where-Object { $_.tier -eq 'staff' }) }
        Write-JsonResponse $context 200 @{ roles = @($definitions) }
        continue
      }
      if ($request.HttpMethod -eq 'POST' -and $path -eq '/api/roles') {
        if ($null -eq $currentUser) { Write-Unauthorized $context; continue }
        if (-not (Test-AdminControl $currentUser)) { Write-Forbidden $context; continue }
        $body = Read-JsonBody $context
        $name = ([string]$body.name).Trim()
        $tier = ([string]$body.tier).Trim().ToLowerInvariant()
        $capabilities = @($body.capabilities | ForEach-Object { [string]$_ } | Select-Object -Unique)
        if ($name.Length -lt 2 -or $name.Length -gt 48 -or $tier -notin @('staff', 'admin') -or ($currentUser.Role -eq 'admin' -and $tier -ne 'staff') -or @($capabilities | Where-Object { $_ -notin $staffCapabilities }).Count -gt 0 -or ($tier -eq 'admin' -and $capabilities.Count -gt 0)) {
          Write-JsonResponse $context 400 @{ error = 'Use a valid role name, permitted tier, and supported capabilities.' }
          continue
        }
        $state = Read-State
        $definitions = if ($state.ContainsKey('role-definitions')) { @($state['role-definitions']) } else { @() }
        if (@($definitions | Where-Object { $_.name -ieq $name -and $_.tier -eq $tier }).Count -gt 0) { Write-JsonResponse $context 409 @{ error = 'That role already exists in this tier.' }; continue }
        $definition = @{ id = [guid]::NewGuid().ToString(); name = $name; tier = $tier; capabilities = @($capabilities); createdBy = $currentUser.Username; createdAt = [DateTime]::UtcNow.ToString('o', [Globalization.CultureInfo]::InvariantCulture) }
        $state['role-definitions'] = @($definitions) + @($definition)
        Write-State $state
        Add-SecurityAuditEvent $currentUser.Username 'role.created' $name $currentUser.Role
        Write-JsonResponse $context 201 @{ role = $definition }
        continue
      }
      if ($request.HttpMethod -eq 'GET' -and $path -eq '/api/industries') {
        if ($null -eq $currentUser) { Write-Unauthorized $context; continue }
        $state = Read-State
        $industries = if ($state.ContainsKey('industry-types')) { @($state['industry-types']) } else { @() }
        Write-JsonResponse $context 200 @{ industries = @($industries) }
        continue
      }
      if ($request.HttpMethod -eq 'POST' -and $path -eq '/api/industries') {
        if ($null -eq $currentUser) { Write-Unauthorized $context; continue }
        if (-not (Test-AdminControl $currentUser)) { Write-Forbidden $context; continue }
        $body = Read-JsonBody $context
        $name = ([string]$body.name).Trim()
        if ($name.Length -lt 2 -or $name.Length -gt 80) { Write-JsonResponse $context 400 @{ error = 'Industry name must be 2-80 characters.' }; continue }
        $state = Read-State
        $industries = if ($state.ContainsKey('industry-types')) { @($state['industry-types']) } else { @() }
        if ($industries.Count -ge 100) { Write-JsonResponse $context 409 @{ error = 'Industry limit reached.' }; continue }
        if (@($industries | Where-Object { [string]$_ -ieq $name }).Count -gt 0) { Write-JsonResponse $context 409 @{ error = 'That industry already exists.' }; continue }
        $state['industry-types'] = @($industries) + @($name)
        Write-State $state
        Add-SecurityAuditEvent $currentUser.Username 'industry.created' $name $currentUser.Role
        Write-JsonResponse $context 201 @{ industry = $name }
        continue
      }

      if ($request.HttpMethod -eq 'POST' -and $path -eq '/api/agent/tasks') {
        if ($null -eq $currentUser) { Write-Unauthorized $context; continue }
        $body = Read-JsonBody $context
        $description = ([string]$body.description).Trim()
        $source = [string]$body.source
        $screenshot = [string]$body.screenshot
        if ($description.Length -lt 3 -or $description.Length -gt 10000 -or $source -notin @('TEXT', 'VOICE')) {
          Write-JsonResponse $context 400 @{ error = 'Add a short typed or voice-transcribed request.' }
          continue
        }
        $screenshotBytes = $null
        $screenshotMime = $null
        if (-not [string]::IsNullOrWhiteSpace($screenshot)) {
          if ($screenshot -notmatch '^data:(image/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$') {
            Write-JsonResponse $context 400 @{ error = 'Use a PNG, JPEG, or WebP screenshot.' }
            continue
          }
          $screenshotMime = $Matches[1]
          try { $screenshotBytes = [Convert]::FromBase64String($Matches[2]) } catch {
            Write-JsonResponse $context 400 @{ error = 'Screenshot data is invalid.' }
            continue
          }
          if ($screenshotBytes.Length -gt 700000) {
            Write-JsonResponse $context 400 @{ error = 'Screenshot must be no larger than 700 KB.' }
            continue
          }
          $screenshot = $Matches[2]
        }
        $state = Read-State
        $tasks = if ($state.ContainsKey('agent-tasks')) { @($state['agent-tasks']) } else { @() }
        $cutoff = [DateTime]::UtcNow.AddHours(-1)
        $recentTaskCount = @($tasks | Where-Object {
          $_.createdBy -eq $currentUser.Username -and
          ([DateTime]::Parse([string]$_.createdAt, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind) -ge $cutoff)
        }).Count
        if ($recentTaskCount -ge 20) { Write-JsonResponse $context 429 @{ error = 'Request limit reached. Try again later.' }; continue }
        $task = @{
          id = [guid]::NewGuid().ToString()
          description = $description
          source = $source
          screenshotMime = $screenshotMime
          screenshot = if ($screenshotBytes) { $screenshot } else { $null }
          createdBy = [string]$currentUser.Username
          status = 'OPEN'
          reviewedBy = $null
          reviewedAt = $null
          createdAt = [DateTime]::UtcNow.ToString('o', [Globalization.CultureInfo]::InvariantCulture)
        }
        $state['agent-tasks'] = @($tasks) + @($task)
        Write-State $state
        $task.Remove('screenshot')
        Write-JsonResponse $context 201 @{ task = $task }
        continue
      }

      if ($request.HttpMethod -eq 'GET' -and $path -eq '/api/agent/tasks') {
        if ($null -eq $currentUser) { Write-Unauthorized $context; continue }
        if (-not (Test-AdminControl $currentUser)) { Write-Forbidden $context; continue }
        $state = Read-State
        $tasks = if ($state.ContainsKey('agent-tasks')) { @($state['agent-tasks']) } else { @() }
        $publicTasks = @($tasks | Sort-Object -Property createdAt -Descending | Select-Object -First 200 | ForEach-Object {
          @{
            id = $_.id; description = $_.description; source = $_.source; screenshotMime = $_.screenshotMime
            createdBy = $_.createdBy; status = $_.status; reviewedBy = $_.reviewedBy
            reviewedAt = $_.reviewedAt; createdAt = $_.createdAt
          }
        })
        Write-JsonResponse $context 200 @{ tasks = $publicTasks }
        continue
      }

      if ($request.HttpMethod -eq 'GET' -and $path -match '^/api/agent/tasks/([a-f0-9-]{36})/screenshot$') {
        if ($null -eq $currentUser) { Write-Unauthorized $context; continue }
        if (-not (Test-AdminControl $currentUser)) { Write-Forbidden $context; continue }
        $taskId = $Matches[1]
        $state = Read-State
        $tasks = if ($state.ContainsKey('agent-tasks')) { @($state['agent-tasks']) } else { @() }
        $task = $tasks | Where-Object { $_.id -eq $taskId } | Select-Object -First 1
        if ($null -eq $task -or [string]::IsNullOrWhiteSpace([string]$task.screenshot)) {
          Write-JsonResponse $context 404 @{ error = 'Screenshot was not found.' }
          continue
        }
        try { $screenshotBytes = [Convert]::FromBase64String([string]$task.screenshot) } catch {
          Write-JsonResponse $context 500 @{ error = 'Saved screenshot data is invalid.' }
          continue
        }
        Write-ScreenshotResponse $context ([string]$task.screenshotMime) $screenshotBytes
        continue
      }

      if ($request.HttpMethod -eq 'PATCH' -and $path -match '^/api/agent/tasks/([a-f0-9-]{36})$') {
        if ($null -eq $currentUser) { Write-Unauthorized $context; continue }
        if (-not (Test-AdminControl $currentUser)) { Write-Forbidden $context; continue }
        $taskId = $Matches[1]
        $body = Read-JsonBody $context
        $status = [string]$body.status
        if ($status -notin @('REVIEWED', 'DISMISSED')) { Write-JsonResponse $context 400 @{ error = 'Choose a valid review status.' }; continue }
        $state = Read-State
        $tasks = if ($state.ContainsKey('agent-tasks')) { @($state['agent-tasks']) } else { @() }
        $task = $tasks | Where-Object { $_.id -eq $taskId } | Select-Object -First 1
        if ($null -eq $task) { Write-JsonResponse $context 404 @{ error = 'Agent request was not found.' }; continue }
        $task.status = $status
        $task.reviewedBy = [string]$currentUser.Username
        $task.reviewedAt = [DateTime]::UtcNow.ToString('o', [Globalization.CultureInfo]::InvariantCulture)
        $state['agent-tasks'] = $tasks
        Write-State $state
        $task.Remove('screenshot')
        Write-JsonResponse $context 200 @{ task = $task }
        continue
      }

      if ($path -like '/api/assistant/*' -or $path -like '/api/code-assistant/*') {
        Write-JsonResponse $context 404 @{ error = 'This assistant endpoint has been removed.' }
        continue
      }

      if ($request.HttpMethod -eq 'POST' -and $path -eq '/api/state/merge') {
        if ($null -eq $currentUser) { Write-Unauthorized $context; continue }
        $body = Read-JsonBody $context
        $collection = [string]$body.collection
        if ($collection -notin @('transactions', 'customers', 'items', 'invoices', 'customer-payments')) { Write-JsonResponse $context 404 @{ error = 'Unknown merge collection.' }; continue }
        if ($currentUser.Role -eq 'staff' -and $collection -notin $staffWritableCollections) { Write-Forbidden $context; continue }
        $requiredCapability = Get-StaffCapabilityForCollection $collection
        if ($currentUser.Role -eq 'staff' -and $requiredCapability -and -not (Test-StaffCapability $currentUser $requiredCapability)) { Write-Forbidden $context; continue }
        if ($body.records -isnot [array]) { Write-JsonResponse $context 400 @{ error = 'A record array is required.' }; continue }
        $submittedDeletedIds = @($body.deletedIds | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })
        if ($currentUser.Role -eq 'staff' -and $submittedDeletedIds.Count -gt 0) { Write-Forbidden $context; continue }
        $state = Read-State
        $existing = if ($state.ContainsKey($collection)) { @($state[$collection]) } else { @() }
        $incoming = @($body.records)
        $deleted = @{}
        foreach ($deletedId in $submittedDeletedIds) { $deleted[[string]$deletedId] = $true }
        $merged = [System.Collections.Generic.List[object]]::new()
        $indexes = @{}
        foreach ($record in $existing) {
          $key = Get-StateRecordKey $collection $record
          if ($null -ne $key -and $deleted.ContainsKey($key)) { continue }
          if ($null -ne $key -and $indexes.ContainsKey($key)) { continue }
          if ($null -ne $key) { $indexes[$key] = $merged.Count }
          $merged.Add($record)
        }
        foreach ($record in $incoming) {
          $key = Get-StateRecordKey $collection $record
          if ($null -ne $key -and $indexes.ContainsKey($key)) {
            $existingRecord = $merged[$indexes[$key]]
            if ($existingRecord.createdBy) {
              $record | Add-Member -MemberType NoteProperty -Name createdBy -Value $existingRecord.createdBy -Force
              $record | Add-Member -MemberType NoteProperty -Name createdByRole -Value $existingRecord.createdByRole -Force
            } else {
              $record | Add-Member -MemberType NoteProperty -Name createdBy -Value $null -Force
              $record | Add-Member -MemberType NoteProperty -Name createdByRole -Value $null -Force
            }
            $merged[$indexes[$key]] = $record
            continue
          }
          if ($null -ne $key) {
            $record | Add-Member -MemberType NoteProperty -Name createdBy -Value ([string]$currentUser.Username) -Force
            $record | Add-Member -MemberType NoteProperty -Name createdByRole -Value ([string]$currentUser.Role) -Force
          }
          if ($null -ne $key) { $indexes[$key] = $merged.Count }
          $merged.Add($record)
        }
        $state[$collection] = $merged.ToArray()
        Write-State $state
        Write-JsonResponse $context 200 @{ collection = $collection; records = $merged.ToArray() }
        continue
      }

      if ($request.HttpMethod -eq 'POST' -and $path -eq '/api/sales') {
        if ($null -eq $currentUser) { Write-Unauthorized $context; continue }
        if ($currentUser.Role -eq 'staff' -and -not (Test-StaffCapability $currentUser 'billing.write')) { Write-Forbidden $context; continue }
        $body = Read-JsonBody $context
        $operationId = ([string]$body.operationId).Trim()
        $invoice = $body.invoice
        if ($operationId -notmatch '^[A-Za-z0-9._:-]{8,128}$' -or $null -eq $invoice -or $invoice.type -ne 'Sales Invoices' -or $null -eq $invoice.customer -or [string]::IsNullOrWhiteSpace([string]$invoice.customer.name)) {
          Write-JsonResponse $context 400 @{ error = 'A valid sales invoice and operation ID are required.' }
          continue
        }
        $sellerLogoData = if ($null -eq $invoice.sellerLogoData) { '' } else { [string]$invoice.sellerLogoData }
        if ($sellerLogoData.Length -gt 240000 -or ($sellerLogoData -and $sellerLogoData -notmatch '^data:image/webp;base64,[A-Za-z0-9+/]+={0,2}$')) {
          Write-JsonResponse $context 400 @{ error = 'The invoice logo snapshot is invalid.' }
          continue
        }

        $state = Read-State
        $invoices = if ($state.ContainsKey('invoices')) { @($state['invoices']) } else { @() }
        $duplicate = $invoices | Where-Object { $_.operationId -eq $operationId } | Select-Object -First 1
        if ($null -ne $duplicate) {
          $items = if ($state.ContainsKey('items')) { @($state['items']) } else { @() }
          $transactions = if ($state.ContainsKey('transactions')) { @($state['transactions']) } else { @() }
          Write-JsonResponse $context 200 @{ invoice = $duplicate; duplicate = $true; items = $items; transactions = $transactions }
          continue
        }

        $dateText = [string]$invoice.date
        $saleDate = [datetime]::MinValue
        if (-not [datetime]::TryParseExact($dateText, 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::None, [ref]$saleDate)) {
          Write-JsonResponse $context 400 @{ error = 'Enter a valid invoice date.' }
          continue
        }
        $rawLines = @($invoice.lineItems | Where-Object { $null -ne $_ })
        if ($rawLines.Count -lt 1 -or $rawLines.Count -gt 100) {
          Write-JsonResponse $context 400 @{ error = 'A sale must contain between 1 and 100 item rows.' }
          continue
        }

        $items = if ($state.ContainsKey('items')) { @($state['items']) } else { @() }
        $lines = [System.Collections.Generic.List[object]]::new()
        $subtotal = [decimal]::Zero
        $saleValidationError = $null
        foreach ($rawLine in $rawLines) {
          $quantity = [decimal]::Zero
          $rate = [decimal]::Zero
          $taxRate = [decimal]::Zero
          $numberStyles = [Globalization.NumberStyles]::Float
          $culture = [Globalization.CultureInfo]::InvariantCulture
          $validQuantity = [decimal]::TryParse([Convert]::ToString($rawLine.quantity, $culture), $numberStyles, $culture, [ref]$quantity)
          $validRate = [decimal]::TryParse([Convert]::ToString($rawLine.rate, $culture), $numberStyles, $culture, [ref]$rate)
          $validTaxRate = [decimal]::TryParse([Convert]::ToString($rawLine.taxRate, $culture), $numberStyles, $culture, [ref]$taxRate)
          if (-not $validQuantity -or $quantity -le 0 -or $quantity -gt 1000000 -or -not $validRate -or $rate -le 0 -or -not $validTaxRate -or $taxRate -notin @(0, 5, 12, 18, 28)) {
            $saleValidationError = 'Each sale row needs a valid quantity, rate, and GST rate.'
            break
          }
          $itemId = [string]$rawLine.itemId
          $item = $items | Where-Object { $_.id -eq $itemId } | Select-Object -First 1
          if ([string]::IsNullOrWhiteSpace($itemId) -or $null -eq $item) {
            $saleValidationError = 'An item in this sale is not synced to the server yet. Retry after item sync.'
            break
          }
          $lineSubtotal = ConvertTo-SaleAmount ($quantity * $rate)
          $subtotal += $lineSubtotal
          $lines.Add(@{ itemId = $itemId; item = [string]$item.name; sku = [string]$item.sku; quantity = $quantity; rate = $rate; taxRate = $taxRate; subtotal = $lineSubtotal })
        }
        if ($null -ne $saleValidationError) {
          $statusCode = if ($saleValidationError.StartsWith('An item')) { 409 } else { 400 }
          Write-JsonResponse $context $statusCode @{ error = $saleValidationError }
          continue
        }
        $subtotal = ConvertTo-SaleAmount $subtotal
        $discountType = [string]$invoice.discountType
        $discountValue = [decimal]::Zero
        $culture = [Globalization.CultureInfo]::InvariantCulture
        $validDiscount = [decimal]::TryParse([Convert]::ToString($invoice.discountValue, $culture), [Globalization.NumberStyles]::Float, $culture, [ref]$discountValue)
        if (-not $validDiscount -or $discountValue -lt 0 -or ($discountType -eq 'percent' -and $discountValue -gt 100) -or $discountType -notin @('percent', 'amount')) {
          Write-JsonResponse $context 400 @{ error = 'Enter a valid fixed discount or a percentage from 0 to 100.' }
          continue
        }
        $discount = if ($discountType -eq 'percent') { ConvertTo-SaleAmount ($subtotal * $discountValue / 100) } else { ConvertTo-SaleAmount ([Math]::Min($subtotal, $discountValue)) }
        $remainingDiscount = $discount
        $discountBase = if ($subtotal -eq 0) { 1 } else { $subtotal }
        $canonicalLines = [System.Collections.Generic.List[object]]::new()
        for ($index = 0; $index -lt $lines.Count; $index++) {
          $line = $lines[$index]
          if ($index -eq $lines.Count - 1) { $lineDiscount = $remainingDiscount }
          else { $lineDiscount = [Math]::Min($remainingDiscount, [Math]::Min($line.subtotal, (ConvertTo-SaleAmount ($discount * $line.subtotal / $discountBase)))) }
          $remainingDiscount = ConvertTo-SaleAmount ($remainingDiscount - $lineDiscount)
          $taxableAmount = ConvertTo-SaleAmount ($line.subtotal - $lineDiscount)
          $tax = ConvertTo-SaleAmount ($taxableAmount * $line.taxRate / 100)
          $lineTotal = ConvertTo-SaleAmount ($taxableAmount + $tax)
          $canonicalLines.Add(@{ itemId = $line.itemId; item = $line.item; sku = $line.sku; quantity = $line.quantity; rate = $line.rate; taxRate = $line.taxRate; subtotal = $line.subtotal; discount = $lineDiscount; taxableAmount = $taxableAmount; tax = $tax; total = $lineTotal })
        }
        $taxTotal = [decimal]::Zero
        foreach ($canonicalLine in $canonicalLines) { $taxTotal += $canonicalLine['tax'] }
        $taxTotal = ConvertTo-SaleAmount $taxTotal
        $total = ConvertTo-SaleAmount ($subtotal - $discount + $taxTotal)
        $year = $saleDate.ToString('yyyy', [Globalization.CultureInfo]::InvariantCulture)
        $invoice.id = 'invoice-' + [Guid]::NewGuid().ToString('N')
        $invoice.operationId = $operationId
        $invoice.number = Get-NextInvoiceNumber $invoices $year
        $invoice.date = $dateText
        $invoice.lineItems = @($canonicalLines.ToArray())
        $invoice.subtotal = $subtotal
        $invoice.discountAmount = $discount
        $invoice.taxTotal = $taxTotal
        $invoice.total = $total
        $invoice.type = 'Sales Invoices'
        $invoice.syncStatus = 'synced'
        $invoice | Add-Member -MemberType NoteProperty -Name createdBy -Value ([string]$currentUser.Username) -Force
        $invoice | Add-Member -MemberType NoteProperty -Name createdByRole -Value ([string]$currentUser.Role) -Force
        if ([string]::IsNullOrWhiteSpace([string]$invoice.paymentMode)) { $invoice | Add-Member -MemberType NoteProperty -Name paymentMode -Value 'Not recorded' -Force }
        elseif ([string]$invoice.paymentMode -notin @('Cash', 'UPI', 'Card', 'Bank transfer', 'Credit / pay later', 'Other')) {
          Write-JsonResponse $context 400 @{ error = 'Choose a supported payment mode.' }
          continue
        }

        foreach ($line in $canonicalLines) {
          $item = $items | Where-Object { $_.id -eq $line.itemId } | Select-Object -First 1
          if ($null -ne $item -and $null -ne $item.stock -and [string]$item.stock -ne '') {
            $item.stock = [Math]::Max(0, ([double]$item.stock - [double]$line.quantity))
          }
        }
        $transactions = if ($state.ContainsKey('transactions')) { @($state['transactions']) } else { @() }
        $transactions = @(@{ date = $saleDate.ToString('dd MMM yyyy', [Globalization.CultureInfo]::InvariantCulture); type = 'Sales Invoices'; number = $invoice.number; party = [string]$invoice.customer.name; amount = $total; createdBy = [string]$currentUser.Username; createdByRole = [string]$currentUser.Role }) + $transactions
        $state['invoices'] = @($invoice) + $invoices
        $state['items'] = $items
        $state['transactions'] = $transactions
        Write-State $state
        Write-JsonResponse $context 201 @{ invoice = $invoice; items = $items; transactions = $transactions }
        continue
      }

      if ($request.HttpMethod -eq 'GET' -and $path -eq '/api/state') {
        if ($null -eq $currentUser) { Write-Unauthorized $context; continue }
        $state = Read-State
        $state.Remove('security-audit')
        $state.Remove('change-events')
        $state.Remove('change-version')
        if ($currentUser.Role -eq 'staff') {
          $state.Remove('business-form')
          $state.Remove('business-details')
          $state.Remove('agent-tasks')
          $state.Remove('role-definitions')
        }
        if ($currentUser.Role -eq 'admin' -and $state.ContainsKey('role-definitions')) {
          $state['role-definitions'] = @($state['role-definitions'] | Where-Object { $_.tier -eq 'staff' })
        }
        Write-JsonResponse $context 200 $state
        continue
      }

      if ($request.HttpMethod -eq 'PUT' -and $path -match '^/api/state/([a-z-]+)$') {
        if ($null -eq $currentUser) { Write-Unauthorized $context; continue }
        $collection = $Matches[1]
        if ($collection -notin $allowedCollections) { Write-JsonResponse $context 404 @{ error = 'Unknown data collection.' }; continue }
        if ($currentUser.Role -eq 'staff' -and $collection -notin $staffWritableCollections) { Write-Forbidden $context; continue }
        $requiredCapability = Get-StaffCapabilityForCollection $collection
        if ($currentUser.Role -eq 'staff' -and $requiredCapability -and -not (Test-StaffCapability $currentUser $requiredCapability)) { Write-Forbidden $context; continue }
        $value = Read-JsonBody $context
        if ($collection -eq 'business-logo' -and ($value -isnot [string] -or $value.Length -gt 240000 -or ($value -and $value -notmatch '^data:image/webp;base64,[A-Za-z0-9+/]+={0,2}$'))) {
          Write-JsonResponse $context 400 @{ error = 'A resized WebP logo no larger than 180 KB is required.' }
          continue
        }
        if ($currentUser.Role -eq 'staff') {
          if ($value -isnot [array]) { Write-JsonResponse $context 400 @{ error = 'A record array is required.' }; continue }
          $state = Read-State
          $existing = if ($state.ContainsKey($collection)) { @($state[$collection]) } else { @() }
          $merged = [System.Collections.Generic.List[object]]::new()
          $indexes = @{}
          foreach ($record in $existing) {
            $key = Get-StateRecordKey $collection $record
            if ($null -ne $key -and $indexes.ContainsKey($key)) { continue }
            if ($null -ne $key) { $indexes[$key] = $merged.Count }
            $merged.Add($record)
          }
          foreach ($record in $value) {
            $key = Get-StateRecordKey $collection $record
            if ($null -ne $key -and $indexes.ContainsKey($key)) {
              $existingRecord = $merged[$indexes[$key]]
              if ($existingRecord.createdBy) {
                $record | Add-Member -MemberType NoteProperty -Name createdBy -Value $existingRecord.createdBy -Force
                $record | Add-Member -MemberType NoteProperty -Name createdByRole -Value $existingRecord.createdByRole -Force
              } else {
                $record | Add-Member -MemberType NoteProperty -Name createdBy -Value $null -Force
                $record | Add-Member -MemberType NoteProperty -Name createdByRole -Value $null -Force
              }
              $merged[$indexes[$key]] = $record
              continue
            }
            if ($null -ne $key) {
              $record | Add-Member -MemberType NoteProperty -Name createdBy -Value ([string]$currentUser.Username) -Force
              $record | Add-Member -MemberType NoteProperty -Name createdByRole -Value ([string]$currentUser.Role) -Force
            }
            if ($null -ne $key) { $indexes[$key] = $merged.Count }
            $merged.Add($record)
          }
          $value = $merged.ToArray()
        }
        $state = Read-State
        $state[$collection] = $value
        Write-State $state
        Write-JsonResponse $context 200 @{ saved = $collection }
        continue
      }

      if ($request.HttpMethod -eq 'GET' -and $path -eq '/api/staff') {
        if ($null -eq $currentUser) { Write-Unauthorized $context; continue }
        if (-not (Test-AdminControl $currentUser)) { Write-Forbidden $context; continue }
        $accountUsers = @(Read-Users)
        if ($currentUser.Role -eq 'admin') { $accountUsers = @($accountUsers | Where-Object { $_.Role -eq 'staff' }) }
        $state = Read-State
        $definitions = if ($state.ContainsKey('role-definitions')) { @($state['role-definitions']) } else { @() }
        $safeUsers = @($accountUsers | ForEach-Object {
          $account = $_
          $definition = $definitions | Where-Object { $_.id -eq $account.RoleDefinitionId } | Select-Object -First 1
          @{ username = $account.Username; displayName = $account.DisplayName; role = $account.Role; roleDefinitionId = $account.RoleDefinitionId; roleDefinitionName = if ($definition) { $definition.name } else { '' }; disabled = ($account.Disabled -eq $true) }
        })
        Write-JsonResponse $context 200 @{ users = @($safeUsers) }
        continue
      }

      if ($request.HttpMethod -eq 'POST' -and $path -eq '/api/staff') {
        if ($null -eq $currentUser) { Write-Unauthorized $context; continue }
        if (-not (Test-AdminControl $currentUser)) { Write-Forbidden $context; continue }
        $body = Read-JsonBody $context
        $username = ([string]$body.username).Trim().ToLowerInvariant()
        $displayName = ([string]$body.displayName).Trim()
        $role = if ([string]::IsNullOrWhiteSpace([string]$body.role)) { 'staff' } else { ([string]$body.role).Trim().ToLowerInvariant() }
        $roleDefinitionId = ([string]$body.roleDefinitionId).Trim()
        $plainPassword = [string]$body.password
        $users = @(Read-Users)
        if ($username -notmatch '^[a-z0-9._-]{3,32}$' -or $displayName.Length -lt 2 -or $role -notin @('staff', 'admin') -or ($currentUser.Role -eq 'admin' -and $role -ne 'staff') -or $plainPassword.Length -lt 6 -or $plainPassword.Length -gt 20) {
          $body.password = $null
          $plainPassword = $null
          Write-JsonResponse $context 400 @{ error = 'Use a valid username, display name, account type, and password of 6-20 characters.' }
          continue
        }
        if ($roleDefinitionId) {
          $state = Read-State
          $definitions = if ($state.ContainsKey('role-definitions')) { @($state['role-definitions']) } else { @() }
          $definition = $definitions | Where-Object { $_.id -eq $roleDefinitionId -and $_.tier -eq $role } | Select-Object -First 1
          if ($null -eq $definition) { $body.password = $null; Write-JsonResponse $context 400 @{ error = 'Choose a role profile belonging to the selected account tier.' }; continue }
        }
        $securePassword = ConvertTo-SecureString -String $plainPassword -AsPlainText -Force
        $body.password = $null
        $plainPassword = $null
        try {
          if (@($users | Where-Object { $_.Username -eq $username }).Count -gt 0) {
            Write-JsonResponse $context 409 @{ error = 'That username already exists.' }
            continue
          }
          $newUser = New-User $username $displayName $securePassword $role '' $roleDefinitionId
          Write-Users @($users + $newUser)
          Add-SecurityAuditEvent $currentUser.Username "account.created.$role" $username $currentUser.Role
          Write-JsonResponse $context 201 @{ user = @{ username = $newUser.Username; displayName = $newUser.DisplayName; role = $newUser.Role } }
        } finally { $securePassword.Dispose() }
        continue
      }

      if ($request.HttpMethod -eq 'PATCH' -and $path -eq '/api/staff/status') {
        if ($null -eq $currentUser) { Write-Unauthorized $context; continue }
        if (-not (Test-AdminControl $currentUser)) { Write-Forbidden $context; continue }
        $body = Read-JsonBody $context
        $username = ([string]$body.username).Trim().ToLowerInvariant()
        if ($body.disabled -isnot [bool] -or -not $username) { Write-JsonResponse $context 400 @{ error = 'Choose an account and a valid access status.' }; continue }
        if ($username -eq $currentUser.Username) { Write-JsonResponse $context 409 @{ error = 'You cannot revoke your own account.' }; continue }
        $users = @(Read-Users)
        $targetUser = $users | Where-Object { $_.Username -eq $username } | Select-Object -First 1
        if ($null -eq $targetUser) { Write-JsonResponse $context 404 @{ error = 'Account not found.' }; continue }
        if ($currentUser.Role -eq 'admin' -and $targetUser.Role -ne 'staff') { Write-Forbidden $context; continue }
        if ($targetUser.Role -eq 'owner') { Write-Forbidden $context; continue }
        $targetUser | Add-Member -MemberType NoteProperty -Name Disabled -Value $body.disabled -Force
        Write-Users -Users $users
        if ($body.disabled) { [BillingSqliteDatabase]::RevokeUserSessions([string]$targetUser.Username) }
        Add-SecurityAuditEvent $currentUser.Username $(if ($body.disabled) { 'account.access_revoked' } else { 'account.access_restored' }) $targetUser.Username $currentUser.Role
        Write-JsonResponse $context 200 @{ username = $targetUser.Username; disabled = $body.disabled }
        continue
      }

      if ($request.HttpMethod -eq 'DELETE' -and $path -eq '/api/staff') {
        if ($null -eq $currentUser) { Write-Unauthorized $context; continue }
        if (-not (Test-AdminControl $currentUser)) { Write-Forbidden $context; continue }
        $username = ([string]$request.QueryString['username']).Trim().ToLowerInvariant()
        if (-not $username -or $username -eq $currentUser.Username) { Write-JsonResponse $context 400 @{ error = 'Choose another account to delete.' }; continue }
        $users = @(Read-Users)
        $targetUser = $users | Where-Object { $_.Username -eq $username } | Select-Object -First 1
        if ($null -eq $targetUser) { Write-JsonResponse $context 404 @{ error = 'Account not found.' }; continue }
        if ($targetUser.Role -eq 'owner' -or ($currentUser.Role -eq 'admin' -and $targetUser.Role -ne 'staff')) { Write-Forbidden $context; continue }
        $remainingUsers = @($users | Where-Object { $_.Username -ne $username })
        Write-Users -Users $remainingUsers
        [BillingSqliteDatabase]::RevokeUserSessions([string]$targetUser.Username)
        Add-SecurityAuditEvent $currentUser.Username "account.deleted.$($targetUser.Role)" $targetUser.Username $currentUser.Role
        Write-JsonResponse $context 200 @{ deleted = $true; username = $targetUser.Username }
        continue
      }

      if ($request.HttpMethod -eq 'POST' -and $path -eq '/api/staff/reset-password') {
        if ($null -eq $currentUser) { Write-Unauthorized $context; continue }
        if (-not (Test-AdminControl $currentUser)) { Write-Forbidden $context; continue }
        $body = Read-JsonBody $context
        $username = ([string]$body.username).Trim().ToLowerInvariant()
        $plainPassword = [string]$body.password
        if ($username.Length -lt 3 -or $username.Length -gt 254 -or $plainPassword.Length -lt 6 -or $plainPassword.Length -gt 20) {
          $body.password = $null
          $plainPassword = $null
          Write-JsonResponse $context 400 @{ error = 'Select an account and use a password of 6-20 characters.' }
          continue
        }
        $securePassword = ConvertTo-SecureString -String $plainPassword -AsPlainText -Force
        $body.password = $null
        $plainPassword = $null
        try {
          $users = @(Read-Users)
          $targetUser = $users | Where-Object { $_.Username -eq $username } | Select-Object -First 1
          if ($null -eq $targetUser) { Write-JsonResponse $context 404 @{ error = 'Account not found.' }; continue }
          if ($currentUser.Role -eq 'admin' -and $targetUser.Role -ne 'staff') { Write-Forbidden $context; continue }
          if ($currentUser.Role -eq 'owner' -and $targetUser.Role -eq 'owner' -and $targetUser.Username -ne $currentUser.Username) { Write-Forbidden $context; continue }
          $passwordRecord = New-PasswordRecord $securePassword
          $targetUser.Salt = $passwordRecord.Salt
          $targetUser.Hash = $passwordRecord.Hash
          Write-Users -Users $users
          [BillingSqliteDatabase]::RevokeUserSessions([string]$targetUser.Username)
          Add-SecurityAuditEvent $currentUser.Username 'account.password_reset' $targetUser.Username $currentUser.Role
          Write-JsonResponse $context 200 @{ reset = $true; username = $targetUser.Username }
        } finally { $securePassword.Dispose() }
        continue
      }

      if ($request.HttpMethod -eq 'GET' -and ($path -eq '/' -or $path -eq '/bill.html')) {
        $bytes = [System.IO.File]::ReadAllBytes((Join-Path $root 'bill.html'))
        Add-SecurityHeaders $context.Response
        $context.Response.StatusCode = 200
        $context.Response.ContentType = 'text/html; charset=utf-8'
        $context.Response.ContentLength64 = $bytes.Length
        $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        $context.Response.Close()
        continue
      }

      $staticAsset = switch ($path) {
        '/billing-tailwind.css' { @{ File = 'billing-tailwind.css'; Type = 'text/css; charset=utf-8' }; break }
        '/localization.js' { @{ File = 'localization.js'; Type = 'text/javascript; charset=utf-8' }; break }
        '/manifest.webmanifest' { @{ File = 'manifest.webmanifest'; Type = 'application/manifest+json; charset=utf-8' }; break }
        '/service-worker.js' { @{ File = 'service-worker.js'; Type = 'text/javascript; charset=utf-8' }; break }
        '/app-icon.svg' { @{ File = 'app-icon.svg'; Type = 'image/svg+xml' }; break }
        default { $null }
      }
      if ($request.HttpMethod -eq 'GET' -and $null -ne $staticAsset) {
        $assetPath = Join-Path $root $staticAsset.File
        if (-not (Test-Path -LiteralPath $assetPath -PathType Leaf)) { Write-JsonResponse $context 404 @{ error = 'Not found.' }; continue }
        $bytes = [System.IO.File]::ReadAllBytes($assetPath)
        Add-SecurityHeaders $context.Response
        $context.Response.StatusCode = 200
        $context.Response.ContentType = $staticAsset.Type
        if ($staticAsset.File -eq 'service-worker.js') { $context.Response.Headers['Cache-Control'] = 'no-cache' }
        $context.Response.ContentLength64 = $bytes.Length
        $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        $context.Response.Close()
        continue
      }

      Write-JsonResponse $context 404 @{ error = 'Not found.' }
    } catch {
      $errorMessage = $_.Exception.Message
      Write-Warning "Request failed: $errorMessage"
      $databaseFailure = $errorMessage -like 'SQLite error:*'
      $statusCode = if ($databaseFailure) { 500 } else { 400 }
      $publicMessage = if ($databaseFailure) { 'Database operation failed. Check the server log.' } else { 'Invalid request.' }
      try { Write-JsonResponse $context $statusCode @{ error = $publicMessage } } catch { $context.Response.Abort() }
    }
  }
} finally {
  $listener.Stop()
  $listener.Close()
  [BillingSqliteDatabase]::Close()
}
