---
name: loading-button
description: Ensures buttons handling async actions use the LoadingButton component with proper state management. Apply when creating or modifying buttons that perform async operations like API calls, form submissions, or data mutations.
allowed-tools: Read, Edit, Write, Grep, Glob
---

# LoadingButton Usage Pattern

This skill ensures consistent async button implementation using the LoadingButton component.

## When to Apply

Use the LoadingButton component for any button that performs:
- Form submissions
- API calls
- Data mutations (create, update, delete)
- File uploads
- Any asynchronous operation

## Implementation Requirements

### 1. Import the Component

Always import both the component and type:

```typescript
import { LoadingButton } from '@/components/ui/loading-button';
import type { ButtonLoadingState } from '@/components/ui/loading-button';
```

### 2. State Management

Define the button state using the correct pattern:

**Single Button:**
```typescript
const [buttonState, setButtonState] = useState<ButtonLoadingState>('default');
```

**Multiple Buttons:**
Name states according to their operation:
```typescript
const [saveButtonState, setSaveButtonState] = useState<ButtonLoadingState>('default');
const [deleteButtonState, setDeleteButtonState] = useState<ButtonLoadingState>('default');
const [submitButtonState, setSubmitButtonState] = useState<ButtonLoadingState>('default');
```

### 3. Button States

The ButtonLoadingState type has 5 possible values:
- `'default'` - Initial/idle state
- `'loading'` - During async operation (shows spinner)
- `'success'` - Operation completed successfully (shows check mark)
- `'error'` - Operation failed
- `'disabled'` - Button is disabled

### 4. Basic Usage Example

```typescript
const [buttonState, setButtonState] = useState<ButtonLoadingState>('default');

const handleSubmit = async () => {
  setButtonState('loading');

  try {
    await someAsyncOperation();
    setButtonState('success');
  } catch (error) {
    setButtonState('error');
    console.error(error);
  }
};

return (
  <LoadingButton
    buttonState={buttonState}
    setButtonState={setButtonState}
    text="Submit"
    loadingText="Submitting..."
    successText="Submitted!"
    errorText="Failed to submit"
    onClick={handleSubmit}
  />
);
```

### 5. Auto-Reset Feature

Enable auto-reset to return to 'default' state after success:

```typescript
<LoadingButton
  buttonState={buttonState}
  setButtonState={setButtonState}
  reset={true}  // Resets to 'default' after 2 seconds
  text="Save"
  loadingText="Saving..."
  successText="Saved!"
  onClick={handleSave}
/>
```

**Important:** When `reset={true}`, you must provide `setButtonState`.

### 6. Required Props

Minimum required props:
- `buttonState` - The current state
- `text` - Default button text

### 7. Optional Props

Enhance UX with custom text for each state:
- `loadingText` - Text/node shown during loading (default shows spinner only)
- `successText` - Text/node shown on success (default shows check mark only)
- `errorText` - Text shown on error
- `setButtonState` - State setter (required if using `reset`)
- `reset` - Auto-reset to default after 2 seconds on success
- Standard button props: `variant`, `size`, `className`, `disabled`, etc.

## Common Patterns

### Form Submission
```typescript
const [submitButtonState, setSubmitButtonState] = useState<ButtonLoadingState>('default');

const onSubmit = async (data: FormData) => {
  setSubmitButtonState('loading');

  try {
    const result = await createItem(data);
    setSubmitButtonState('success');
  } catch (error) {
    setSubmitButtonState('error');
    toast.error('Failed to create item');
  }
};
```

### Delete Action
```typescript
const [deleteButtonState, setDeleteButtonState] = useState<ButtonLoadingState>('default');

const handleDelete = async () => {
  setDeleteButtonState('loading');

  try {
    await deleteItem(itemId);
    setDeleteButtonState('success');
    router.push('/items');
  } catch (error) {
    setDeleteButtonState('error');
  }
};
```

### Multiple Actions on Same Form
```typescript
const [saveButtonState, setSaveButtonState] = useState<ButtonLoadingState>('default');
const [publishButtonState, setPublishButtonState] = useState<ButtonLoadingState>('default');

const handleSave = async (draft: boolean) => {
  const setState = draft ? setSaveButtonState : setPublishButtonState;
  setState('loading');

  try {
    await savePost({ ...data, draft });
    setState('success');
  } catch (error) {
    setState('error');
  }
};
```

## Migration from Standard Button

When you see a regular Button handling async operations:

**Before:**
```typescript
<Button onClick={handleSubmit} disabled={isLoading}>
  {isLoading ? 'Loading...' : 'Submit'}
</Button>
```

**After:**
```typescript
const [buttonState, setButtonState] = useState<ButtonLoadingState>('default');

const handleSubmit = async () => {
  setButtonState('loading');
  try {
    await operation();
    setButtonState('success');
  } catch (error) {
    setButtonState('error');
  }
};

<LoadingButton
  buttonState={buttonState}
  setButtonState={setButtonState}
  text="Submit"
  loadingText="Loading..."
  reset={true}
  onClick={handleSubmit}
/>
```

## What to Check

When reviewing code or implementing buttons:

1. ✅ Does the button perform an async operation?
2. ✅ Is LoadingButton imported correctly?
3. ✅ Is ButtonLoadingState type imported?
4. ✅ Is state defined with correct type annotation?
5. ✅ Are multiple button states named descriptively?
6. ✅ Does the async handler update state correctly (loading → success/error)?
7. ✅ Is error handling in place?
8. ✅ Is `setButtonState` provided when using `reset={true}`?

## Component Reference

Location: `components/ui/loading-button.tsx`

The LoadingButton is built on top of the base Button component and adds:
- Automatic loading spinner (Loader2Icon)
- Success checkmark (Check icon)
- State-based text switching
- Auto-reset functionality
- Proper disabled state management

## Common Mistakes to Avoid

❌ Forgetting to set state to 'loading':
```typescript
// Wrong - button won't show loading state
const handleClick = async () => {
  await operation();
  setButtonState('success');
};
```

❌ Not handling errors:
```typescript
// Wrong - button stays in loading state on error
const handleClick = async () => {
  setButtonState('loading');
  await operation(); // If this fails, state never updates
  setButtonState('success');
};
```

❌ Using `reset` without `setButtonState`:
```typescript
// Wrong - will throw error
<LoadingButton
  buttonState={buttonState}
  reset={true}  // Requires setButtonState!
  text="Save"
/>
```

❌ Generic state names with multiple buttons:
```typescript
// Wrong - confusing when multiple buttons exist
const [buttonState1, setButtonState1] = useState<ButtonLoadingState>('default');
const [buttonState2, setButtonState2] = useState<ButtonLoadingState>('default');

// Better
const [saveButtonState, setSaveButtonState] = useState<ButtonLoadingState>('default');
const [deleteButtonState, setDeleteButtonState] = useState<ButtonLoadingState>('default');
```

## Implementation Checklist

When implementing or reviewing LoadingButton usage:

- [ ] Imported LoadingButton component
- [ ] Imported ButtonLoadingState type
- [ ] Defined state with proper type annotation
- [ ] State names are descriptive (if multiple buttons)
- [ ] Set state to 'loading' before async operation
- [ ] Set state to 'success' after successful operation
- [ ] Set state to 'error' in catch block
- [ ] Provided meaningful text for each state
- [ ] Added error handling/logging
- [ ] Used `reset` prop if auto-reset is desired
- [ ] Provided `setButtonState` when using `reset`
