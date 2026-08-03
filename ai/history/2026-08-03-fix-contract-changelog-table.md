# Fix CONTRACT.md changelog table formatting

## Problem

The version changelog table in `CONTRACT.md` rendered incorrectly: stray italic markers on recent rows, a multi-column separator, and unescaped `|` characters inside cell text that split rows into extra columns.

## Fix

- Restored accidental working-tree markdown corruption (italic wrappers, broken link ticks, list indentation).
- Escaped in-cell pipes as `\|` for versions `51`, `41`, and `21`.
- Reduced the separator to two columns.
- Repaired smashed spacing introduced by the broken splits (`and`, `alongside`).
