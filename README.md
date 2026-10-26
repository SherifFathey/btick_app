<div align="center">

# BTick

</div>

> [!TIP]
> 📚 **Complete Documentation Available**: Detailed installation guides, bridge protocol specifications, multi-machine networking, and API reference can be found in our official docs: **[sheriffathey.github.io/btick_docs](https://sheriffathey.github.io/btick_docs/)**.

---

## 🚀 Overview

**BTick** is a high-performance, real-time visualization and debugging tool for robotic behavior trees. It provides roboticists and software engineers with live insight into tree topology, active execution states, blackboard variables, and node transitions.

BTick works seamlessly across **ROS 2 DDS topics**, **Groot2 ZeroMQ/TCP servers**, and **Nav2 log topics**, and can be used directly from any modern web browser or as a native Linux desktop application.

## Quick Start BTick [Web & Desktop Visualizer]

- ### Option 1: Docker for Web Browser

  Launch BTick with full ROS 2 host networking:

  ```bash
  docker compose up -d
  ```

  Then open **[`http://localhost:3000`](http://localhost:3000)** in your browser.

  ***

- ### Option 2: Standalone Desktop App (Linux)

  Download the `.deb` package from [Releases](https://github.com/SherifFathey/btick_app/releases) and install:

  ```bash
  sudo apt install ./btick_*.deb
  btick
  ```

---

<div align="center">

**Made with ❤️ for the Robotics Community**

</div>
