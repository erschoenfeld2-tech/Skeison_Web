"""Prueft und fuehrt das Modellier-Skript aus, das Claude schreibt (Weg GENERATOR=claude).

Das Skript entsteht aus der Beschreibung eines Besuchers und ist damit NICHT vertrauenswuerdig.
Deshalb zwei Schutzschichten, bevor es in Blender laeuft:
1. check(code): statische Pruefung des Syntaxbaums (ohne bpy, laeuft auch ausserhalb von Blender).
   - nur import bpy, bmesh, math, mathutils, random
   - von bpy nur bpy.data.<meshes|objects|materials|curves|collections> (kein bpy.ops, bpy.context, bpy.app ...),
     .ops nur als bmesh.ops (reine Geometrie)
   - keine Namen/Attribute mit "__", keine Frame-/Code-Attribute (gi_frame, f_globals, ...),
     keine gefaehrlichen Funktionen (open, exec, eval, getattr, ...), kein str.format, keine Klassen
   - keine Datei-, Treiber- und Skript-Attribute (filepath, save, load, drivers, node_tree, ...)
2. run(code, helpers): Ausfuehrung mit eingeschraenkten builtins und nur den erlaubten Modulen.
Zusaetzlich laeuft Blender als eigener Prozess mit Zeitlimit und niedriger Prioritaet (blender_runner.py).
"""
from __future__ import annotations

import ast

MAX_LEN = 30000
MODULES = {"bpy", "bmesh", "math", "mathutils", "random"}
BPY_DATA_OK = {"meshes", "objects", "materials", "curves", "collections"}
BANNED_NAMES = {
    "exec", "eval", "compile", "open", "__import__", "getattr", "setattr", "delattr", "hasattr", "globals", "locals",
    "vars", "input", "breakpoint", "help", "memoryview", "type", "object", "super", "classmethod", "staticmethod",
    "property", "dir", "exit", "quit", "license", "credits", "copyright", "bytearray", "bytes", "__builtins__",
}
BANNED_ATTRS = {
    # Blender: Dateien, Operatoren, Oberflaeche, Python-Ausfuehrung ueber Treiber/Nodes/Texte
    "app", "utils", "context", "preferences", "window_manager", "window", "screen", "area", "scripts",
    "texts", "libraries", "images", "sounds", "movieclips", "fonts", "filepath", "filepath_raw", "save",
    "save_as_mainfile", "save_render", "write", "load", "reload", "handlers", "driver_namespace", "driver_add",
    "drivers", "driver", "expression", "node_tree", "nodes", "path_resolve", "operator", "operators", "keymaps",
    "addons", "library", "user_remap", "as_pointer", "batch_remove", "orphans_purge", "bl_rna", "rna_type",
    # Python: Formatierung mit Attributzugriff
    "format", "format_map", "mro",
}
BANNED_PREFIXES = ("gi_", "f_", "tb_", "co_", "cr_", "ag_", "func_", "im_")


class ScriptError(ValueError):
    pass


def _bad_attr(name: str) -> bool:
    return "__" in name or name in BANNED_ATTRS or name.startswith(BANNED_PREFIXES)


def check(code: str) -> None:
    """Wirft ScriptError mit einer kurzen Begruendung, wenn das Skript nicht erlaubt ist."""
    if len(code) > MAX_LEN:
        raise ScriptError(f"Skript zu lang (max. {MAX_LEN} Zeichen)")
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        raise ScriptError(f"Syntaxfehler in Zeile {e.lineno}: {e.msg}") from e

    parents: dict[int, ast.AST] = {}
    for node in ast.walk(tree):
        for child in ast.iter_child_nodes(node):
            parents[id(child)] = node

    for node in ast.walk(tree):
        line = getattr(node, "lineno", "?")
        if isinstance(node, (ast.ClassDef, ast.AsyncFunctionDef, ast.Await, ast.Global, ast.Nonlocal)):
            raise ScriptError(f"Zeile {line}: {type(node).__name__} ist nicht erlaubt")
        if isinstance(node, ast.Import):
            for a in node.names:
                if a.name not in MODULES or (a.asname and a.asname != a.name):
                    raise ScriptError(f"Zeile {line}: import {a.name} ist nicht erlaubt")
        elif isinstance(node, ast.ImportFrom):
            if node.module not in {"math", "mathutils", "random"} or node.level:
                raise ScriptError(f"Zeile {line}: from {node.module} import ... ist nicht erlaubt")
            for a in node.names:
                if a.name == "*" or _bad_attr(a.name) or a.name in BANNED_NAMES:
                    raise ScriptError(f"Zeile {line}: from {node.module} import {a.name} ist nicht erlaubt")
        elif isinstance(node, ast.Name):
            if "__" in node.id or node.id in BANNED_NAMES:
                raise ScriptError(f"Zeile {line}: {node.id} ist nicht erlaubt")
            # bpy nur als bpy.data.<erlaubt>, nie als Wert weitergeben (kein Alias)
            if node.id == "bpy":
                p = parents.get(id(node))
                pp = parents.get(id(p)) if p is not None else None
                if isinstance(p, ast.Import):
                    continue
                if not (isinstance(p, ast.Attribute) and p.attr == "data" and isinstance(pp, ast.Attribute)
                        and pp.attr in BPY_DATA_OK):
                    raise ScriptError(f"Zeile {line}: von bpy ist nur bpy.data.{{{','.join(sorted(BPY_DATA_OK))}}} erlaubt")
            if isinstance(node.ctx, (ast.Store, ast.Del)) and node.id in MODULES:
                raise ScriptError(f"Zeile {line}: {node.id} darf nicht ueberschrieben werden")
        elif isinstance(node, ast.Attribute):
            if _bad_attr(node.attr):
                raise ScriptError(f"Zeile {line}: .{node.attr} ist nicht erlaubt")
            if node.attr == "ops" and not (isinstance(node.value, ast.Name) and node.value.id == "bmesh"):
                raise ScriptError(f"Zeile {line}: .ops ist nur als bmesh.ops erlaubt")
            if isinstance(node.ctx, (ast.Store, ast.Del)) and isinstance(node.value, ast.Name) and node.value.id in MODULES:
                raise ScriptError(f"Zeile {line}: Module duerfen nicht veraendert werden")
        elif isinstance(node, ast.Constant) and isinstance(node.value, str) and "__" in node.value:
            raise ScriptError(f"Zeile {line}: Zeichenketten mit '__' sind nicht erlaubt")
        elif isinstance(node, ast.alias):
            pass


SAFE_BUILTINS = {
    n: __builtins__[n] if isinstance(__builtins__, dict) else getattr(__builtins__, n)
    for n in ("abs", "all", "any", "bool", "dict", "divmod", "enumerate", "filter", "float", "int", "isinstance",
              "len", "list", "map", "max", "min", "pow", "print", "range", "reversed", "round", "set", "sorted",
              "str", "sum", "tuple", "zip", "Exception", "ValueError", "IndexError", "KeyError", "ZeroDivisionError",
              "RuntimeError", "True", "False", "None")
}


def run(code: str, helpers: dict) -> dict:
    """Fuehrt das gepruefte Skript aus. helpers: zusaetzliche Funktionen/Werte fuer das Skript."""
    check(code)
    import importlib

    allowed = {}
    for m in MODULES:
        try:
            allowed[m] = importlib.import_module(m)
        except ImportError:  # ausserhalb von Blender (Tests): bpy/bmesh/mathutils fehlen
            pass

    def _import(name, globals=None, locals=None, fromlist=(), level=0):  # noqa: A002
        if level or name not in allowed:
            raise ImportError(f"import {name} ist nicht erlaubt")
        return allowed[name]

    env_builtins = dict(SAFE_BUILTINS)
    env_builtins["__import__"] = _import
    env = {"__builtins__": env_builtins, "__name__": "modell", **allowed, **helpers}
    exec(compile(code, "modell.py", "exec"), env)  # noqa: S102 - nach check() und mit eingeschraenkten builtins
    return env
