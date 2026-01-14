"""Format markdown tables to have consistent column widths."""

import re
import sys
from pathlib import Path


def find_tables(content: str) -> list[tuple[int, int]]:
    """Find all table ranges in markdown content.
    
    Returns:
        List of (start_line, end_line) tuples (0-indexed)
    """
    lines = content.split('\n')
    tables = []
    in_table = False
    start_line = 0
    
    for i, line in enumerate(lines):
        # Check if line looks like a table row
        if '|' in line and line.strip().startswith('|'):
            if not in_table:
                in_table = True
                start_line = i
        else:
            if in_table:
                tables.append((start_line, i - 1))
                in_table = False
    
    # Handle table at end of file
    if in_table:
        tables.append((start_line, len(lines) - 1))
    
    return tables


def format_table(table_lines: list[str]) -> list[str]:
    """Format a table to have consistent column widths."""
    if not table_lines:
        return table_lines
    
    # Parse table rows
    rows = []
    for line in table_lines:
        # Split by | and clean up
        cells = [cell.strip() for cell in line.split('|')]
        # Remove empty first/last cells from leading/trailing pipes
        if cells and not cells[0]:
            cells = cells[1:]
        if cells and not cells[-1]:
            cells = cells[:-1]
        rows.append(cells)
    
    if not rows:
        return table_lines
    
    # Calculate max width for each column
    num_cols = len(rows[0])
    col_widths = [0] * num_cols
    
    for row in rows:
        for i, cell in enumerate(row):
            if i < num_cols:
                # For alignment rows, keep minimum width
                if re.match(r'^:?-+:?$', cell):
                    col_widths[i] = max(col_widths[i], len(cell))
                else:
                    col_widths[i] = max(col_widths[i], len(cell))
    
    # Format rows
    formatted_lines = []
    for row in rows:
        cells = []
        for i, cell in enumerate(row):
            if i < num_cols:
                # Check if this is an alignment row
                if re.match(r'^:?-+:?$', cell):
                    # Preserve alignment markers
                    left_align = cell.startswith(':')
                    right_align = cell.endswith(':')
                    dashes = '-' * col_widths[i]
                    if left_align and right_align:
                        formatted_cell = ':' + dashes[1:-1] + ':'
                    elif left_align:
                        formatted_cell = ':' + dashes[1:]
                    elif right_align:
                        formatted_cell = dashes[:-1] + ':'
                    else:
                        formatted_cell = dashes
                    cells.append(formatted_cell)
                else:
                    # Regular cell - left pad
                    cells.append(cell.ljust(col_widths[i]))
        
        formatted_lines.append('| ' + ' | '.join(cells) + ' |')
    
    return formatted_lines


def format_markdown_tables(content: str) -> str:
    """Format all tables in markdown content."""
    lines = content.split('\n')
    tables = find_tables(content)
    
    # Process tables in reverse order to preserve line numbers
    for start, end in reversed(tables):
        table_lines = lines[start:end+1]
        formatted = format_table(table_lines)
        lines[start:end+1] = formatted
    
    return '\n'.join(lines)


def process_file(file_path: Path) -> bool:
    """Process a single markdown file."""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        formatted_content = format_markdown_tables(content)
        
        if content != formatted_content:
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(formatted_content)
            return True
        return False
    except Exception as e:
        print(f"Error processing {file_path}: {e}", file=sys.stderr)
        return False


def main():
    """Main function to format tables in docs directory."""
    docs_dir = Path(__file__).parent.parent.parent / 'docs'
    
    if not docs_dir.exists():
        print(f"Error: docs directory not found at {docs_dir}", file=sys.stderr)
        sys.exit(1)
    
    md_files = list(docs_dir.rglob('*.md'))
    modified_count = 0
    
    print(f"Found {len(md_files)} markdown files")
    
    for md_file in md_files:
        if process_file(md_file):
            modified_count += 1
            print(f"✓ Formatted: {md_file.relative_to(docs_dir)}")
    
    print(f"\nFormatted {modified_count} files")


if __name__ == '__main__':
    main()
