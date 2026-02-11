---
name: edge-functions
description: Ensures Supabase Edge Functions are invoked using the SDK client pattern instead of raw fetch. Apply when creating or modifying code that calls Supabase Edge Functions.
allowed-tools: Read, Edit, Write, Grep, Glob
---

# Supabase Edge Functions Invocation Pattern

This skill ensures consistent and secure invocation of Supabase Edge Functions using the official SDK.

## When to Apply

Use the Supabase SDK pattern for any code that:
- Calls a Supabase Edge Function
- Sends data to an edge function endpoint
- Receives data from an edge function

## Why Use the SDK

The SDK pattern is preferred over raw `fetch` because:
- **Automatic authentication**: JWT tokens are automatically attached
- **Type safety**: Better TypeScript integration
- **Error handling**: Structured error types for granular handling
- **Consistency**: Matches patterns used throughout the codebase
- **Maintainability**: Base URL and auth configured once

## Implementation Requirements

### 1. Import the Supabase Client

For client components:
```typescript
import { supabaseBrowser } from '@/supabase/utils/client';
```

For server components/actions:
```typescript
import { supabaseServer } from '@/supabase/utils/server';
```

### 2. Basic Invocation Pattern

```typescript
const supabase = supabaseBrowser();

const { data, error } = await supabase.functions.invoke('function-name', {
  body: { key: 'value' }
});

if (error) {
  throw new Error(error.message || 'Function call failed');
}

// Use data
console.log(data);
```

### 3. Function Signature

```typescript
const { data, error } = await supabase.functions.invoke(functionName, options);
```

**Parameters:**
- `functionName` (string, required): Name of the edge function to invoke
- `options` (object, optional): Configuration object

**Options Properties:**
- `body`: Request payload (auto-serialized as JSON for objects)
- `headers`: Custom HTTP headers (Record<string, string>)
- `method`: HTTP method ('GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE')
- `region`: FunctionRegion to specify deployment region

### 4. Content-Type Handling

The SDK automatically handles Content-Type headers:
- `Blob`, `ArrayBuffer`, `File`, `FormData`, `String`: Auto-detected
- Objects: Serialized as JSON with `application/json` header

**FormData Example (file uploads):**
```typescript
const formData = new FormData();
formData.append('file', file);
formData.append('organization_id', organizationId.toString());

const { data, error } = await supabase.functions.invoke('parse-lease', {
  body: formData
});
```

**JSON Example:**
```typescript
const { data, error } = await supabase.functions.invoke('send-notification', {
  body: {
    userId: user.id,
    message: 'Hello world'
  }
});
```

### 5. Error Handling

The SDK provides three error types for granular handling:

```typescript
import {
  FunctionsHttpError,
  FunctionsRelayError,
  FunctionsFetchError
} from '@supabase/supabase-js';

const { data, error } = await supabase.functions.invoke('my-function', {
  body: { key: 'value' }
});

if (error) {
  if (error instanceof FunctionsHttpError) {
    // Function returned an error response (4xx, 5xx)
    const errorMessage = await error.context.json();
    console.error('Function error:', errorMessage);
  } else if (error instanceof FunctionsRelayError) {
    // Relay infrastructure issue
    console.error('Relay error:', error.message);
  } else if (error instanceof FunctionsFetchError) {
    // Network/fetch failure
    console.error('Fetch error:', error.message);
  }
  throw error;
}
```

**Simple Error Handling:**
```typescript
if (error) {
  throw new Error(error.message || 'Failed to call function');
}
```

### 6. Response Parsing

Responses are automatically parsed based on Content-Type:
- `application/json`: Parsed as JSON
- `blob`: Returned as Blob
- `form-data`: Parsed as FormData
- Default: Returned as text

## Common Patterns

### API Call with Loading State

```typescript
const [buttonState, setButtonState] = useState<ButtonLoadingState>('default');

const handleAction = async () => {
  setButtonState('loading');
  const supabase = supabaseBrowser();

  try {
    const { data, error } = await supabase.functions.invoke('process-data', {
      body: { itemId }
    });

    if (error) {
      throw new Error(error.message);
    }

    setButtonState('success');
    return data;
  } catch (err) {
    setButtonState('error');
    Sentry.captureException(err);
    throw err;
  }
};
```

### File Upload

```typescript
const handleUpload = async (file: File, organizationId: string) => {
  const supabase = supabaseBrowser();

  const formData = new FormData();
  formData.append('file', file);
  formData.append('organization_id', organizationId);

  const { data, error } = await supabase.functions.invoke('parse-document', {
    body: formData
  });

  if (error) {
    throw new Error(error.message || 'Upload failed');
  }

  return data;
};
```

### GET Request

```typescript
const { data, error } = await supabase.functions.invoke('get-status', {
  method: 'GET'
});
```

### Custom Headers

```typescript
const { data, error } = await supabase.functions.invoke('external-api', {
  body: { query: 'search term' },
  headers: {
    'X-Custom-Header': 'value'
  }
});
```

## Migration from Raw Fetch

When you see edge function calls using raw `fetch`:

**Before (Anti-pattern):**
```typescript
const response = await fetch(
  `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/send-notification`,
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY}`
    },
    body: JSON.stringify({
      userId,
      message
    })
  }
);

if (!response.ok) {
  throw new Error('Failed to send notification');
}

const data = await response.json();
```

**After (Correct pattern):**
```typescript
import { supabaseBrowser } from '@/supabase/utils/client';

const supabase = supabaseBrowser();

const { data, error } = await supabase.functions.invoke('send-notification', {
  body: {
    userId,
    message
  }
});

if (error) {
  throw new Error(error.message || 'Failed to send notification');
}
```

## What to Check

When reviewing code or implementing edge function calls:

1. Is the Supabase client imported correctly?
2. Is `supabase.functions.invoke` being used instead of raw `fetch`?
3. Is the function name passed as the first argument (not a full URL)?
4. Is the body being passed in the options object?
5. Is error handling in place?
6. Are errors being reported to Sentry for production issues?

## Common Mistakes to Avoid

**Using raw fetch with manual auth:**
```typescript
// Wrong - bypasses SDK benefits
const response = await fetch(
  `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/my-function`,
  {
    headers: {
      Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY}`
    },
    body: JSON.stringify(data)
  }
);
```

**Forgetting to check for errors:**
```typescript
// Wrong - error not handled
const { data } = await supabase.functions.invoke('my-function', {
  body: payload
});
// data could be undefined if there was an error
```

**Including full URL in function name:**
```typescript
// Wrong
await supabase.functions.invoke('/functions/v1/my-function', { body });

// Correct
await supabase.functions.invoke('my-function', { body });
```

**Manually setting Content-Type for JSON:**
```typescript
// Unnecessary - SDK handles this automatically
await supabase.functions.invoke('my-function', {
  body: data,
  headers: {
    'Content-Type': 'application/json' // Not needed for objects
  }
});
```

## Implementation Checklist

When implementing or reviewing edge function calls:

- [ ] Imported correct Supabase client (browser or server)
- [ ] Using `supabase.functions.invoke` instead of raw fetch
- [ ] Function name is just the name (not full URL path)
- [ ] Body is passed in options object
- [ ] Error is checked after invocation
- [ ] Appropriate error message provided to user
- [ ] Sentry error reporting for production debugging
- [ ] Loading states managed correctly (if UI involved)

## Reference

**Supabase Client Locations:**
- Browser client: `supabase/utils/client.ts`
- Server client: `supabase/utils/server.ts`

**Documentation:**
- [Supabase Functions Invoke Reference](https://supabase.com/docs/reference/javascript/functions-invoke)
- [Edge Functions Guide](https://supabase.com/docs/guides/functions)
