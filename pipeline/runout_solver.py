"""Depth-averaged debris-flow solver with Voellmy friction, batched on the GPU (PyTorch, MPS on a Mac).

    dh/dt + div(h u) = 0
    d(hu)/dt + div(h u u) = -g' h grad(z + h) - friction
    friction = u/|u| * ( mu g' h + g |u|^2 (1 + s^2) / xi )        (Voellmy: dry Coulomb part + turbulent part)

h is the vertical flow depth, u the horizontal velocity, z the bed, s = |grad z| and g' = g / (1 + s^2) is gravity
reduced for a sloping bed (the horizontal projection of motion along the slope). mu and xi are the two friction
numbers that get calibrated.

Numerics: first-order finite volumes, Rusanov flux for the advective part, centred surface-gradient force, friction
applied afterwards so it can stop the flow but never reverse it. The numerical diffusion is switched off where
nothing moves, so a deposit stays where it stopped. Every item in the batch is its own small terrain window.
"""
import torch

G = 9.81


def device():
    return torch.device("mps" if torch.backends.mps.is_available() else "cuda" if torch.cuda.is_available() else "cpu")


@torch.no_grad()
def simulate(z, h0, mu, xi, dx=10.0, t_end=120.0, cfl=0.3, h_min=0.01, h_arrive=0.1, still=0.3, max_dt=0.5):
    """z, h0: [B, H, W] bed elevation and release depth (m). mu, xi: [B]. Returns a dict of [B, H, W] tensors:
    hmax (largest depth seen), tarr (seconds until depth first passes h_arrive, inf if never), vmax, h (final),
    plus lost [B] (share of the volume that left the window) and steps/time."""
    B, H, W = z.shape
    zx = torch.zeros_like(z); zy = torch.zeros_like(z)
    zx[:, :, 1:-1] = (z[:, :, 2:] - z[:, :, :-2]) / (2 * dx); zx[:, :, 0] = (z[:, :, 1] - z[:, :, 0]) / dx; zx[:, :, -1] = (z[:, :, -1] - z[:, :, -2]) / dx
    zy[:, 1:-1] = (z[:, 2:] - z[:, :-2]) / (2 * dx); zy[:, 0] = (z[:, 1] - z[:, 0]) / dx; zy[:, -1] = (z[:, -1] - z[:, -2]) / dx
    s2 = zx * zx + zy * zy
    gp = G / (1 + s2)
    mu = mu.view(B, 1, 1); xi = xi.view(B, 1, 1)
    turb = G * (1 + s2) / xi
    h = h0.clone(); qx = torch.zeros_like(h); qy = torch.zeros_like(h)
    hmax = h0.clone(); vmax = torch.zeros_like(h)
    tarr = torch.full_like(h, float("inf")); tarr[h0 > h_arrive] = 0.0
    vol0 = h0.sum((1, 2)).clamp_min(1e-9); lost = torch.zeros(B, device=z.device)
    t, n = 0.0, 0
    one = torch.ones_like(h)

    def face(hL, hR, nL, nR, tL, tR, cL, cR):
        """Rusanov flux through a face. n: velocity across the face, t: along it."""
        vmag = torch.maximum(torch.maximum(nL.abs(), nR.abs()), torch.maximum(tL.abs(), tR.abs()))
        a = torch.maximum(nL.abs(), nR.abs()) + torch.maximum(cL, cR) * (vmag / 1.0).clamp(max=1.0)
        fh = 0.5 * (hL * nL + hR * nR) - 0.5 * a * (hR - hL)
        fn = 0.5 * (hL * nL * nL + hR * nR * nR) - 0.5 * a * (hR * nR - hL * nL)
        ft = 0.5 * (hL * nL * tL + hR * nR * tR) - 0.5 * a * (hR * tR - hL * tL)
        return fh, fn, ft

    while t < t_end:
        wet = h > h_min
        hs = torch.where(wet, h, one)
        u = torch.where(wet, qx / hs, 0.0); v = torch.where(wet, qy / hs, 0.0)
        c = torch.sqrt(gp * h)
        sp = torch.sqrt(u * u + v * v)
        amax = float((sp + c).max())
        dt = min(cfl * dx / max(amax, 1e-6), max_dt, t_end - t)
        k = dt / dx
        fh, fn, ft = face(h[:, :, :-1], h[:, :, 1:], u[:, :, :-1], u[:, :, 1:], v[:, :, :-1], v[:, :, 1:], c[:, :, :-1], c[:, :, 1:])
        gh, gn, gt = face(h[:, :-1], h[:, 1:], v[:, :-1], v[:, 1:], u[:, :-1], u[:, 1:], c[:, :-1], c[:, 1:])
        # surface-gradient force (bed slope + depth gradient), centred
        ex = torch.zeros_like(h); ey = torch.zeros_like(h)
        ex[:, :, 1:-1] = (h[:, :, 2:] - h[:, :, :-2]) / (2 * dx); ey[:, 1:-1] = (h[:, 2:] - h[:, :-2]) / (2 * dx)
        hn = h.clone(); qxn = qx - dt * gp * h * (zx + ex); qyn = qy - dt * gp * h * (zy + ey)
        hn[:, :, :-1] -= k * fh; hn[:, :, 1:] += k * fh; hn[:, :-1] -= k * gh; hn[:, 1:] += k * gh
        qxn[:, :, :-1] -= k * fn; qxn[:, :, 1:] += k * fn; qxn[:, :-1] -= k * gt; qxn[:, 1:] += k * gt
        qyn[:, :, :-1] -= k * ft; qyn[:, :, 1:] += k * ft; qyn[:, :-1] -= k * gn; qyn[:, 1:] += k * gn
        hn.clamp_(min=0.0)
        # friction: Coulomb part can only take speed down to zero, turbulent part is implicit
        wet = hn > h_min
        hs = torch.where(wet, hn, one)
        sp = torch.sqrt(qxn * qxn + qyn * qyn) / hs
        s1 = (sp - dt * mu * gp).clamp(min=0.0)
        s1 = s1 / (1 + dt * turb * s1 / hs)
        f = torch.where(wet & (sp > 1e-9), s1 / sp.clamp_min(1e-9), 0.0)
        h, qx, qy = hn, qxn * f, qyn * f
        # open edges: whatever reaches the two outer cells leaves the window
        edge = h[:, :2].sum((1, 2)) + h[:, -2:].sum((1, 2)) + h[:, 2:-2, :2].sum((1, 2)) + h[:, 2:-2, -2:].sum((1, 2))
        lost += edge / vol0
        h[:, :2] = 0; h[:, -2:] = 0; h[:, :, :2] = 0; h[:, :, -2:] = 0
        t += dt; n += 1
        hmax = torch.maximum(hmax, h)
        vmax = torch.maximum(vmax, torch.where(h > h_arrive, s1, 0.0))
        tarr = torch.where((h > h_arrive) & torch.isinf(tarr), t, tarr)
        if n % 40 == 0 and t > 8 and float(torch.where(h > 0.05, s1, 0.0).max()) < still:
            break
    return {"hmax": hmax, "tarr": tarr, "vmax": vmax, "h": h, "lost": lost, "steps": n, "time": t,
            "mass_err": (h.sum((1, 2)) / vol0 + lost - 1)}


def selftest(dev=None):
    """A block sliding down a 30 degree plane onto flat ground with Coulomb friction only (xi very large).
    A point mass stops at x = drop / mu from the start; the front of the deposit should be near that.
    Returns (where the deposit's centre of mass stopped, the point-mass answer), both in metres along x."""
    dev = dev or device()
    dx, W, H = 10.0, 220, 40
    x = torch.arange(W, device=dev) * dx
    ramp = 300.0
    zline = torch.where(x < ramp, (ramp - x) * 0.57735, torch.zeros_like(x))
    # round the kink over 40 m so the centred slope is defined
    zline = torch.nn.functional.avg_pool1d(torch.nn.functional.pad(zline[None, None], (2, 2), mode="replicate"), 5, 1)[0, 0]
    z = zline[None, None, :].expand(1, H, W).contiguous()
    h0 = torch.zeros(1, H, W, device=dev); h0[:, 14:26, 5:11] = 2.0
    x0 = float((h0[0] * x).sum() / h0.sum()); z0 = float((h0[0] * z[0]).sum() / h0.sum())
    mu = 0.35
    r = simulate(z, h0, torch.tensor([mu], device=dev), torch.tensor([1e7], device=dev), dx=dx, t_end=200.0)
    xc = float((r["h"][0] * x).sum() / r["h"][0].sum())
    return xc - x0, z0 / mu, float(r["mass_err"][0]), r["steps"]


if __name__ == "__main__":
    got, want, merr, steps = selftest()
    print(f"plane test: centre of mass stopped {got:.0f} m from the start; a point mass stops at {want:.0f} m. mass error {merr:+.4f}, {steps} steps")
