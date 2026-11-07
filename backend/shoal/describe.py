"""Child-process helper: print variables of a FABM configuration as JSON."""
import json
import sys


def main(path: str) -> None:
    import pyfabm

    m = pyfabm.Model(path)
    out = {"state": [], "diagnostic": []}
    bottom = {id(v) for v in m.bottom_state_variables}
    for v in list(m.interior_state_variables) + list(m.bottom_state_variables) + list(m.surface_state_variables):
        out["state"].append({"name": v.output_name, "units": v.units, "long_name": v.long_name,
                             "domain": "bottom" if id(v) in bottom else "interior"})
    for d, dom in [(d, "interior") for d in m.interior_diagnostic_variables] + [(d, "horizontal") for d in m.horizontal_diagnostic_variables]:
        out["diagnostic"].append({"name": d.output_name, "units": d.units, "long_name": d.long_name,
                                  "domain": dom, "output": bool(d.output)})
    sys.stdout.write("@@JSON@@" + json.dumps(out))
    sys.stdout.flush()


if __name__ == "__main__":
    main(sys.argv[1])
